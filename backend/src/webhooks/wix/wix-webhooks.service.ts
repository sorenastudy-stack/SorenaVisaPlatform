import { Injectable, Logger } from '@nestjs/common';
import { generateClientId } from '../../leads/client-id';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import {
  isValidCountryCode,
  getAlpha2CodeFromName,
} from '../../common/country-codes';
import { normaliseWixPayload, pickEnvelopeString } from './wix-payload-normaliser';

// PR-WIX-1 — Wix lead-capture service.
//
// Three responsibilities:
//   1. Normalise the inbound Wix payload (delegates to the
//      normaliser — it handles the fuzzy field mapping).
//   2. Validate the required fields (email + fullName). All others
//      are best-effort: we'd rather land a partial lead than
//      reject + force Wix to retry forever.
//   3. Dedupe-on-write via `externalSubmissionId`. Same email +
//      same `submittedAt` (or same minute when submittedAt is
//      missing) produces the same key, so retries are no-ops.
//
// Lead row schema lines up with PR-WIX-1's schema additions —
// `currentEducationLevel`, `externalSubmissionId`, `countryRaw`,
// and `webhookMetadata` (JSON). Contact upsert mirrors the
// PublicService pattern so the existing CRM funnel picks the
// lead up without surprises.
//
// EMAIL_REGEX is intentionally lenient — Wix already does its own
// validation, and tightening here just means more rejected leads.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+0-9 ()\-]{5,32}$/;
const SYSTEM_ACTOR_NAME  = 'Wix Webhook';
const SYSTEM_ACTOR_ROLE  = 'SYSTEM';

export type CaptureResult =
  | { status: 'created';   leadId: string }
  | { status: 'duplicate'; leadId: string }
  | { status: 'invalid';   error: string };

@Injectable()
export class WixWebhooksService {
  private readonly logger = new Logger(WixWebhooksService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly events:  EventsService,
    private readonly config:  ConfigService,
  ) {}

  async processCapture(body: unknown): Promise<CaptureResult> {
    const norm = normaliseWixPayload(body);

    // Validation — only the bare minimum so the lead can be
    // followed up. Anything else (phone, country, education) is
    // best-effort and stored as captured.
    if (!norm.email || !EMAIL_REGEX.test(norm.email) || norm.email.length > 255) {
      return { status: 'invalid', error: 'Missing or invalid `email`' };
    }
    if (!norm.fullName || norm.fullName.trim().length === 0 || norm.fullName.length > 160) {
      return { status: 'invalid', error: 'Missing or invalid `fullName`' };
    }

    // Phone: tolerate junk by clearing the field rather than 400-ing.
    const phone = norm.phone && PHONE_REGEX.test(norm.phone) ? norm.phone : null;

    // Country resolution: 2 chars → treat as alpha-2 + validate;
    // otherwise try name → alpha-2. On failure store the raw value
    // in `countryRaw` so the OWNER can audit it later.
    let countryOfResidence: string | null = null;
    let countryRaw:          string | null = null;
    if (norm.countryOfResidence) {
      const v = norm.countryOfResidence.trim();
      if (v.length === 2 && isValidCountryCode(v.toUpperCase())) {
        countryOfResidence = v.toUpperCase();
      } else {
        const code = getAlpha2CodeFromName(v, 'en');
        if (code) {
          countryOfResidence = code;
        } else {
          countryRaw = v;
        }
      }
    }

    const currentEducationLevel = norm.currentEducationLevel
      ? norm.currentEducationLevel.trim().slice(0, 100)
      : null;

    // Submission envelope — Wix may send submissionId / submittedAt
    // at the top level. submittedAt is the dedupe input; absent →
    // floor to the current minute so a quick retry collapses.
    const submittedAtRaw = pickEnvelopeString(body, ['submittedAt', 'createdAt', 'timestamp']);
    const submissionIdRaw = pickEnvelopeString(body, ['submissionId', 'id', 'submission_id']);
    const submittedAt = this.parseSubmittedAt(submittedAtRaw);
    const externalSubmissionId = this.computeDedupeKey(norm.email, submittedAt);

    // Dedupe.
    const existing = await this.prisma.lead.findUnique({
      where:  { externalSubmissionId },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`[wix] duplicate submission ${externalSubmissionId} → lead ${existing.id}`);
      return { status: 'duplicate', leadId: existing.id };
    }

    const pageUrl = pickEnvelopeString(body, ['pageUrl', 'page', 'pageurl', 'sourceUrl']);
    const formId  = pickEnvelopeString(body, ['formId', 'form', 'formid']);
    const webhookMetadata = {
      pageUrl:          pageUrl ?? null,
      formId:           formId  ?? null,
      submissionIdRaw:  submissionIdRaw ?? null,
      submittedAt:      submittedAt.toISOString(),
      rawPayloadKeys:   norm.rawPayloadKeys,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      // Contact upsert. Find by email (unique) — mirrors the
      // PublicService.submitIntakeForm path so the lead-to-contact
      // attachment is consistent across both intake sources.
      const contact = await tx.contact.upsert({
        where: { email: norm.email! },
        update: {
          fullName:           norm.fullName!,
          phone:              phone ?? undefined,
          countryOfResidence: countryOfResidence ?? undefined,
        },
        create: {
          fullName:           norm.fullName!,
          email:              norm.email!,
          phone:              phone ?? undefined,
          countryOfResidence: countryOfResidence ?? undefined,
          preferredLanguage:  'en',
        },
      });

      // PR-CLIENT-ID — permanent human-readable id (country from the Wix-
      // provided residence/raw name, falling back to the contact).
      const clientId = await generateClientId(tx, {
        countryOfResidence,
        countryRaw,
        contactId: contact.id,
      });
      const lead = await tx.lead.create({
        data: {
          clientId,
          contactId:             contact.id,
          sourceChannel:         'WIX_LEAD_CAPTURE',
          leadStatus:            'NEW' as never,
          currentEducationLevel,
          externalSubmissionId,
          countryRaw,
          webhookMetadata:       webhookMetadata as never,
        },
      });

      // Mirror PublicService — emit a LEAD_CREATED CrmEvent with the
      // SYSTEM trigger so the downstream funnel (scoring,
      // notifications, ownership assignment) treats this exactly
      // like any other lead.
      await this.events.emit(
        'LEAD_CREATED',
        'LEAD',
        lead.id,
        lead.id,
        'SYSTEM',
        null,
        { source: 'WIX_LEAD_CAPTURE' },
        tx,
      );

      // Audit log row — per the spec. userId is null because there
      // is no User actor; the snapshot columns from PR-CONSULT-4
      // carry the "Wix Webhook / SYSTEM" attribution so the
      // activity feed reads cleanly.
      await tx.auditLog.create({
        data: {
          userId:             null,
          action:             'WIX_LEAD_CAPTURED',
          eventType:          'WIX_LEAD_CAPTURED',
          entityType:         'Lead',
          entityId:           lead.id,
          newValue: {
            leadId:       lead.id,
            source:       'WIX',
            email_masked: maskEmail(norm.email!),
          },
          actorNameSnapshot:  SYSTEM_ACTOR_NAME,
          actorRoleSnapshot:  SYSTEM_ACTOR_ROLE,
        },
      });

      return { leadId: lead.id };
    });

    this.logger.log(`[wix] captured lead ${result.leadId} (${maskEmail(norm.email)})`);
    return { status: 'created', leadId: result.leadId };
  }

  // Dedupe key: sha256(email + '|' + submittedAt + '|' + secret),
  // first 32 chars. Email is lowercased + trimmed so casing
  // variants between retries collapse. The secret is included so
  // an attacker who can guess the email + minute can't pre-compute
  // a colliding `externalSubmissionId` to poison the dedupe table.
  private computeDedupeKey(email: string, submittedAt: Date): string {
    const secret = this.config.get<string>('WIX_WEBHOOK_SECRET') ?? '';
    const input  = `${email.toLowerCase().trim()}|${submittedAt.toISOString()}|${secret}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  // Accepts an ISO string or anything `new Date()` can parse.
  // Falls back to the current minute (truncated) so multiple
  // retries within the same minute collapse onto the same key.
  private parseSubmittedAt(input: string | null): Date {
    if (input) {
      const parsed = new Date(input);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const now = new Date();
    now.setSeconds(0, 0);
    return now;
  }
}

// Mask the inbox half of an email so the audit log can name it
// without leaking PII. "alice.smith@example.com" → "a***@example.com".
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return `***${email.slice(at)}`;
  return `${email[0]}***${email.slice(at)}`;
}
