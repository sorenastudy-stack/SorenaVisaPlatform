import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { generateClientId } from '../leads/client-id';
import {
  isValidCountryCode,
  getAlpha2CodeFromName,
} from '../common/country-codes';
import { normaliseWebinarPayload, pickEnvelopeString } from './webinar-payload-normaliser';

// PR-WEBINAR-1 — Webinar registration service.
//
// Mirrors `webhooks/wix/wix-webhooks.service.ts`'s shape (normalise → validate →
// dedupe → transactional write → event + audit) but for the sorenavisa.com
// website's webinar registration flow. Two deliberate differences from the Wix
// path:
//   - Dedupe key is (webinarId, email), a real unique constraint, not a
//     time-window hash. Registering twice for the SAME webinar is a no-op;
//     registering for a DIFFERENT webinar with the same email is a new row.
//   - The Lead is looked up by contact email and reused if one already exists
//     (a repeat registrant, or someone who already came through the Wix form or
//     the Scorecard) rather than always creating a new one — Lead.clientId is
//     the one authoritative shared ID, so a second Lead per webinar signup for
//     the same person would undermine it.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+0-9 ()\-]{5,32}$/;
const SYSTEM_ACTOR_NAME = 'Website Webinar Registration';
const SYSTEM_ACTOR_ROLE = 'SYSTEM';

export type RegisterResult =
  | { status: 'registered'; registrationId: string; webinar: WebinarSummary }
  | { status: 'duplicate';  registrationId: string; webinar: WebinarSummary }
  | { status: 'invalid';    error: string }
  | { status: 'not_found';  error: string };

export interface WebinarSummary {
  title: string;
  startsAt: Date;
  durationMin: number;
  joinUrl: string | null;
}

@Injectable()
export class WebinarsService {
  private readonly logger = new Logger(WebinarsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async listUpcoming() {
    const webinars = await this.prisma.webinar.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE'] }, startsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      select: {
        slug: true,
        title: true,
        description: true,
        startsAt: true,
        durationMin: true,
        speaker: true,
        topic: true,
        status: true,
      },
    });
    // joinUrl deliberately excluded from the public list — handed back only in
    // the registration confirmation, so it is not scrapeable without
    // registering.
    return webinars;
  }

  async register(body: unknown): Promise<RegisterResult> {
    const norm = normaliseWebinarPayload(body);

    if (!norm.webinarSlug) {
      return { status: 'invalid', error: 'Missing `webinarSlug`' };
    }
    if (!norm.email || !EMAIL_REGEX.test(norm.email) || norm.email.length > 255) {
      return { status: 'invalid', error: 'Missing or invalid `email`' };
    }
    if (!norm.fullName || norm.fullName.trim().length === 0 || norm.fullName.length > 160) {
      return { status: 'invalid', error: 'Missing or invalid name' };
    }

    const webinar = await this.prisma.webinar.findUnique({ where: { slug: norm.webinarSlug } });
    if (!webinar) {
      return { status: 'not_found', error: `No webinar with slug '${norm.webinarSlug}'` };
    }

    const email = norm.email.toLowerCase().trim();
    const fullName = norm.fullName.trim();
    const phone = norm.phone && PHONE_REGEX.test(norm.phone) ? norm.phone : null;

    // The form's country field is free text, so resolve it to alpha-2 where we
    // can and keep the raw string when we cannot — never discard what they
    // typed just because it did not match a code.
    let countryOfResidence: string | null = null;
    let countryRaw: string | null = null;
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

    // Dedupe on (webinarId, email) — the real unique constraint.
    const existing = await this.prisma.webinarRegistration.findUnique({
      where: { webinarId_email: { webinarId: webinar.id, email } },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`[webinar] duplicate registration ${maskEmail(email)} → ${webinar.slug}`);
      return {
        status: 'duplicate',
        registrationId: existing.id,
        webinar: summarise(webinar),
      };
    }

    const utmSource   = pickEnvelopeString(body, ['utmSource', 'utm_source']);
    const utmMedium   = pickEnvelopeString(body, ['utmMedium', 'utm_medium']);
    const utmCampaign = pickEnvelopeString(body, ['utmCampaign', 'utm_campaign']);
    const landingPage = pickEnvelopeString(body, ['landingPage', 'landing_page', 'pageUrl']);

    const result = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.upsert({
        where: { email },
        update: {
          fullName,
          phone: phone ?? undefined,
          countryOfResidence: countryOfResidence ?? undefined,
        },
        create: {
          fullName,
          email,
          phone: phone ?? undefined,
          countryOfResidence: countryOfResidence ?? undefined,
          preferredLanguage: 'en',
        },
      });

      // Reuse an existing Lead for this contact if one already exists (repeat
      // registrant / already came through Wix or the Scorecard). Most recently
      // created wins if there happens to be more than one.
      let lead = await tx.lead.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
      });

      if (!lead) {
        const clientId = await generateClientId(tx, {
          countryOfResidence,
          countryRaw,
          contactId: contact.id,
        });
        lead = await tx.lead.create({
          data: {
            clientId,
            contactId: contact.id,
            sourceChannel: 'WEBSITE_WEBINAR',
            // leadStatus omitted — the column already defaults to NEW.
          },
        });

        await this.events.emit(
          'LEAD_CREATED',
          'LEAD',
          lead.id,
          lead.id,
          'SYSTEM',
          null,
          { source: 'WEBSITE_WEBINAR', webinarSlug: webinar.slug },
          tx,
        );
      }

      const registration = await tx.webinarRegistration.create({
        data: {
          webinarId: webinar.id,
          leadId: lead.id,
          email,
          fullName,
          phone,
          countryOfResidence: countryOfResidence ?? countryRaw,
          intendedStudyLevel: norm.intendedStudyLevel,
          intake: norm.intake,
          // Recorded as submitted rather than assumed. `undefined` falls back
          // to the column default (true) only when the caller said nothing.
          operationalConsent: norm.operationalConsent ?? undefined,
          marketingConsent: norm.marketingConsent ?? undefined,
          utmSource,
          utmMedium,
          utmCampaign,
          landingPage,
        },
      });

      await this.events.emit(
        'WEBINAR_REGISTERED',
        'WebinarRegistration',
        registration.id,
        lead.id,
        'SYSTEM',
        null,
        { webinarId: webinar.id, webinarSlug: webinar.slug },
        tx,
      );

      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'WEBINAR_REGISTERED',
          eventType: 'WEBINAR_REGISTERED',
          entityType: 'WebinarRegistration',
          entityId: registration.id,
          newValue: {
            registrationId: registration.id,
            leadId: lead.id,
            webinarSlug: webinar.slug,
            email_masked: maskEmail(email),
          },
          actorNameSnapshot: SYSTEM_ACTOR_NAME,
          actorRoleSnapshot: SYSTEM_ACTOR_ROLE,
        },
      });

      return registration;
    });

    this.logger.log(`[webinar] registered ${maskEmail(email)} → ${webinar.slug}`);
    return { status: 'registered', registrationId: result.id, webinar: summarise(webinar) };
  }
}

function summarise(webinar: { title: string; startsAt: Date; durationMin: number; joinUrl: string | null }): WebinarSummary {
  return {
    title: webinar.title,
    startsAt: webinar.startsAt,
    durationMin: webinar.durationMin,
    joinUrl: webinar.joinUrl,
  };
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return `***${email.slice(at)}`;
  return `${email[0]}***${email.slice(at)}`;
}
