import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { generateClientId } from '../leads/client-id';
import {
  isValidCountryCode,
  getAlpha2CodeFromName,
} from '../common/country-codes';
import { normaliseWebinarPayload, pickEnvelopeString } from './webinar-payload-normaliser';
import {
  WebinarEmailLifecycleService,
  buildWebinarEmailSchedule,
} from './webinar-email-lifecycle.service';
import { normalizeEmail } from '../common/normalize-email';
import { webinarLeadAttribution } from './webinar-attribution';

// PR-WEBINAR-1 — Webinar registration service.
//
// Mirrors `webhooks/wix/wix-webhooks.service.ts`'s shape (normalise → validate →
// dedupe → transactional write → event + audit) but for the sorenavisa.com
// website's webinar registration flow. Two deliberate differences from the Wix
// path:
//   - Dedupe key is (webinarId, email), a real unique constraint, not a
//     time-window hash. Registering twice for the SAME OCCURRENCE (one specific
//     week's session — `webinarId`, not `slug`) is a no-op; registering for a
//     later week of a recurring series, or a different webinar entirely, is a
//     new row. See PR-WEBINAR-2: `slug` identifies a recurring series and
//     resolves to the next upcoming occurrence — deliberately not unique on
//     Webinar, precisely so a weekly regular isn't blocked from registering
//     again. Their Lead stays the same one either way.
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
    private readonly webinarEmails: WebinarEmailLifecycleService,
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

    // PR-WEBINAR-2: `slug` identifies a recurring SERIES, not one eternal row —
    // the website always sends the same static slug regardless of which week's
    // session it is. Resolve to the next upcoming occurrence of that series.
    //
    // The time filter is load-bearing, not decoration. Without it the earliest
    // SCHEDULED row wins even when its session is long past — so after any gap
    // in the recurrence cron the public page would advertise next Wednesday
    // while registrations silently attached people to LAST Wednesday. A LIVE
    // row is included whatever its start time, because a session running right
    // now is exactly the one a late registrant wants to join, and it sorts
    // first for the same reason.
    const now = new Date();
    const webinar = await this.prisma.webinar.findFirst({
      where: {
        slug: norm.webinarSlug,
        OR: [
          { status: 'LIVE' },
          { status: 'SCHEDULED', startsAt: { gte: now } },
        ],
      },
      orderBy: { startsAt: 'asc' },
    });
    if (!webinar) {
      return { status: 'not_found', error: `No upcoming webinar with slug '${norm.webinarSlug}'` };
    }

    const email = normalizeEmail(norm.email)!;
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
    const incomingAttribution = { utmSource, utmMedium, utmCampaign };

    const result = await this.prisma.$transaction(async (tx) => {
      let contact = await tx.contact.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      contact = contact
        ? await tx.contact.update({
          where: { id: contact.id },
          data: {
          fullName,
          phone: phone ?? undefined,
          countryOfResidence: countryOfResidence ?? undefined,
          },
        })
        : await tx.contact.create({ data: {
          fullName,
          email,
          phone: phone ?? undefined,
          countryOfResidence: countryOfResidence ?? undefined,
          preferredLanguage: 'en',
        } });

      // Reuse an existing Lead for this contact if one already exists (repeat
      // registrant / already came through Wix or the Scorecard). Most recently
      // created wins if there happens to be more than one.
      let lead = await tx.lead.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
      });

      if (!lead) {
        const leadAttribution = webinarLeadAttribution(null, incomingAttribution);
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
            ...leadAttribution,
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
      } else {
        // Canonical Lead reuse: preserve its origin and first campaign, but
        // record this webinar as the latest measurable conversion touch.
        const leadAttribution = webinarLeadAttribution(lead, incomingAttribution);
        lead = await tx.lead.update({
          where: { id: lead.id },
          data: leadAttribution,
        });
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
          // Free text the registrant typed. Stored verbatim for staff to read;
          // nothing parses it.
          question: norm.question,
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

      // Create the entire operational email lifecycle in the SAME transaction
      // as registration. A committed registration can therefore never be left
      // without its confirmation/reminder jobs, and the unique ledger key makes
      // this safe against retries.
      await tx.webinarEmailDelivery.createMany({
        data: buildWebinarEmailSchedule(registration.id, webinar, now),
        skipDuplicates: true,
      });

      await this.events.emit(
        'WEBINAR_REGISTERED',
        'WebinarRegistration',
        registration.id,
        lead.id,
        'SYSTEM',
        null,
        {
          webinarId: webinar.id,
          webinarSlug: webinar.slug,
          utmSource,
          utmMedium,
          utmCampaign,
          landingPage,
        },
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

    // Attempt the confirmation now for a good user experience. Delivery errors
    // never roll back the already-committed registration; the durable FAILED
    // row remains eligible for the minute cron's retry policy.
    try {
      await this.webinarEmails.dispatchDueForRegistration(result.id);
    } catch (err: any) {
      this.logger.error(
        `[webinar-email] immediate dispatch failed registration=${result.id}: ${err?.message ?? err}`,
      );
    }

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
