import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { MailService } from '../mail/mail.service';
import { buildDigestEmail } from './digest.email';
import type { DigestItem } from './digest.types';

// Phase 8 — weekly client digest, data-gathering layer.
//
// Given a CRM caseId + a date window, returns the digest-worthy events
// for that client as render-ready items. The email / cron / UI layers
// consume this output unchanged.
//
// Locked event allow-list (14 types): the only events that may appear
// in the output. Anything outside this set is invisible to the client.
//
// Internal fields stripped at the source:
//   • LIA_MANUAL_REASSIGNED.reason / reasonLength — internal commentary.
//   • PAYMENT_VERIFICATION_REJECTED — excluded entirely from this layer.
//   • DOCUMENT_REMOVED, CASE_OFFICER_*, LEGAL_*, RISK_OVERRIDDEN, etc. —
//     excluded.
//
// The query strategy is two-pass:
//   Pass A — entityType='CASE' AND entityId=caseId. Direct, covers the
//            5 case-scoped event types.
//   Pass B — for PAYMENT / DOCUMENT / VisaMeeting / VisaSupportTicket,
//            first find the entity ids belonging to this case (or to
//            the client behind the case), then query auditLog for
//            those ids only.
//
// Schema entity names: the audit rows use the ACTUAL Prisma model
// names — 'PAYMENT', 'DOCUMENT', 'VisaMeeting' (not 'MEETING'),
// 'VisaSupportTicket' (not 'TICKET'). Confirmed against the writers.

const CASE_EVENT_TYPES = [
  'INZ_SUBMITTED',
  'VISA_ISSUED',
  'LIA_AUTO_ASSIGNED',
  'LIA_MANUAL_REASSIGNED',
  'CASE_DOCUMENT_REQUESTED',
] as const;

const PAYMENT_EVENT_TYPES = [
  'PAYMENT_RECORDED_MANUAL',
  'PAYMENT_VERIFICATION_CONFIRMED',
] as const;

const DOCUMENT_EVENT_TYPES = ['DOCUMENT_UPLOADED'] as const;

const MEETING_EVENT_TYPES = [
  'MEETING_CREATED',
  'MEETING_UPDATED',
  'MEETING_CANCELLED',
] as const;

const TICKET_EVENT_TYPES = [
  'TICKET_MESSAGE_SENT',
  'TICKET_STATUS_CHANGED',
] as const;

// Client-side actor roles. Used as a secondary defence on the ticket
// paths where the primary `byStaff === true` check already handles
// null/missing safely.
const CLIENT_ROLES = new Set(['LEAD', 'STUDENT']);

// Known staff roles from prisma/schema.prisma → enum UserRole. The
// digest's DOCUMENT_UPLOADED filter uses this as the include-list
// (fail-safe): only rows whose actorRoleSnapshot is a definitively
// known staff role survive. A null, missing, or unrecognised role
// (AGENT, LEAD, STUDENT, an enum value added in a future PR we don't
// know about yet) is EXCLUDED rather than risk leaking a non-staff
// upload to the client as if it were staff-authored.
//
// AGENT is an affiliate role — explicitly not staff — and is not in
// this set. LEAD + STUDENT are clients — not in this set.
const STAFF_ROLES = new Set([
  'OWNER',
  'SUPER_ADMIN',
  'ADMIN',
  'LIA',
  'CONSULTANT',
  'SUPPORT',
  'FINANCE',
  'SALES',
  'OPERATIONS',
]);

// Terminal ticket states the client should hear about — staff
// resolved or staff closed. The client closing their own ticket
// fires a separate event (TICKET_CLOSED_BY_CLIENT, not in our
// allow-list) and is therefore already invisible.
const TICKET_TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED']);

export interface SendClientDigestResult {
  sent:      boolean;
  reason?:   'case-not-found' | 'no-email';
  itemCount: number;
}

export interface DigestActor {
  id:   string;
  name: string | null;
  role: string | null;
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly crypto:        CryptoService,
    private readonly mail: MailService,
  ) {}

  /**
   * Compose and send one weekly digest for one case.
   *
   * Flow:
   *   1. Resolve the client's email + display name.
   *   2. Gather the week's events.
   *   3. Build the email (populated OR empty-week branch — both render).
   *   4. Hand off to NotificationsService.sendWeeklyDigest.
   *
   * Returns a small result object so the future cron can log per-case
   * outcomes. NEVER throws on missing case / missing email — those
   * are normal sweep-time conditions, not errors. The underlying
   * sendEmail itself swallows SMTP failures (log + return), so a
   * down SMTP relay can't crash the cron mid-sweep either.
   */
  async sendClientDigest(
    caseId: string,
    since:  Date,
    until:  Date,
  ): Promise<SendClientDigestResult> {
    const c = await this.prisma.case.findUnique({
      where:  { id: caseId },
      select: {
        lead: {
          select: {
            contact: {
              select: { email: true, fullName: true },
            },
          },
        },
      },
    });
    if (!c) {
      this.logger.warn(`Digest skipped — case ${caseId} not found`);
      return { sent: false, reason: 'case-not-found', itemCount: 0 };
    }

    const email    = c.lead?.contact?.email?.trim() ?? null;
    const fullName = c.lead?.contact?.fullName ?? null;
    if (!email) {
      this.logger.warn(`Digest skipped — case ${caseId} contact has no email`);
      return { sent: false, reason: 'no-email', itemCount: 0 };
    }

    const items = await this.gatherClientDigest(caseId, since, until);

    // Portal URL convention matches the rest of NotificationsService:
    // `${APP_URL}/<path>`, with the same in-code fallback. /portal/case
    // is the LEAD/STUDENT landing page (Phase 7). The portal layout
    // bounces unauthenticated visitors to /login?next=/portal/case, so
    // this single URL works for both signed-in and signed-out states.
    const portalUrl = `${process.env.APP_URL ?? 'https://app.sorenavisa.com'}/portal/case`;
    const { subject, html } = buildDigestEmail(fullName, items, portalUrl);

    await this.mail.sendWeeklyDigest(email, subject, html);
    return { sent: true, itemCount: items.length };
  }

  /**
   * Manual staff-triggered send. Wraps sendClientDigest, then writes
   * an audit row recording WHO triggered it, on WHICH case, with what
   * window, and the outcome. Use this from the staff-only endpoint so
   * manual sends are traceable distinct from the future cron path
   * (which will get its own eventType DIGEST_SENT_CRON).
   *
   * Audit failure is best-effort: a row write error is logged and
   * swallowed so a transient `audit_logs` write problem doesn't make
   * the trigger response misreport the actual send result.
   */
  async triggerManualDigest(
    caseId: string,
    since:  Date,
    until:  Date,
    actor:  DigestActor,
  ): Promise<SendClientDigestResult> {
    const result = await this.sendClientDigest(caseId, since, until);

    try {
      await this.prisma.auditLog.create({
        data: {
          userId:            actor.id,
          action:            'CREATE',
          eventType:         'DIGEST_SENT_MANUAL',
          entityType:        'CASE',
          entityId:          caseId,
          newValue: {
            caseId,
            sent:      result.sent,
            reason:    result.reason ?? null,
            itemCount: result.itemCount,
            since:     since.toISOString(),
            until:     until.toISOString(),
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Audit write failed for DIGEST_SENT_MANUAL on case ${caseId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return result;
  }

  /**
   * Gather digest-worthy events for a single CRM case in [since, until).
   *
   * Returns an array of render-ready items sorted by occurredAt ascending.
   * Returns [] if the case doesn't exist — never throws on a missing case
   * because the caller (a weekly cron sweeping every active case) should
   * tolerate races where a case was deleted between row selection and
   * gather time.
   */
  async gatherClientDigest(
    caseId: string,
    since:  Date,
    until:  Date,
  ): Promise<DigestItem[]> {
    // ─── Case → contact → user (the client behind this case) ──────────
    //
    // Path used: Case → lead → contact → user. The Contact.userId is
    // populated either at signup or by linkContactByEmail at Google
    // sign-in (Phase 7). For pre-portal clients it may be null — in
    // that case meetings + tickets (which key on User id) yield zero
    // rows, and the case-scoped + payment + document passes still run.
    const c = await this.prisma.case.findUnique({
      where:  { id: caseId },
      select: {
        id:   true,
        lead: {
          select: {
            contact: {
              select: { id: true, userId: true },
            },
          },
        },
      },
    });
    if (!c) return [];
    const clientUserId = c.lead?.contact?.userId ?? null;

    // ─── Pass A — case-scoped audit rows ──────────────────────────────
    const caseRows = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'CASE',
        entityId:   caseId,
        eventType:  { in: [...CASE_EVENT_TYPES] },
        createdAt:  { gte: since, lt: until },
      },
      orderBy: { createdAt: 'asc' },
    });

    // ─── Pass B1 — payments tied to this case ─────────────────────────
    //
    // Same OR shape as PaymentsService.listPaymentsForCase: a payment
    // counts as "this case's" either by direct caseId link
    // (ACCOUNT_OPENING + manual) or by lead.cases (consultation +
    // subscription rows that pre-date the case row).
    const payments = await this.prisma.payment.findMany({
      where: {
        OR: [
          { caseId },
          { lead: { cases: { some: { id: caseId } } } },
        ],
      },
      select: { id: true, amount: true, currency: true },
    });
    const paymentById = new Map(payments.map((p) => [p.id, p]));
    const paymentRows = payments.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'PAYMENT',
            entityId:   { in: payments.map((p) => p.id) },
            eventType:  { in: [...PAYMENT_EVENT_TYPES] },
            createdAt:  { gte: since, lt: until },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // ─── Pass B2 — documents on this case ─────────────────────────────
    const documents = await this.prisma.document.findMany({
      where:  { caseId },
      select: { id: true, originalName: true },
    });
    const documentById = new Map(documents.map((d) => [d.id, d]));
    const documentRows = documents.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'DOCUMENT',
            entityId:   { in: documents.map((d) => d.id) },
            eventType:  { in: [...DOCUMENT_EVENT_TYPES] },
            createdAt:  { gte: since, lt: until },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // ─── Pass B3 — meetings (VisaMeeting, keyed on student user id) ───
    //
    // VisaMeeting has no caseId — it ties to studentId. For a contact
    // with a User row, "this case's meetings" === "this client's
    // meetings". If the contact has multiple CRM cases (rare), the
    // digest will include meetings from all of them; acceptable scope.
    const meetings = clientUserId
      ? await this.prisma.visaMeeting.findMany({
          where:  { studentId: clientUserId },
          select: { id: true, scheduledAt: true },
        })
      : [];
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    const meetingRows = meetings.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'VisaMeeting',
            entityId:   { in: meetings.map((m) => m.id) },
            eventType:  { in: [...MEETING_EVENT_TYPES] },
            createdAt:  { gte: since, lt: until },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // ─── Pass B4 — support tickets (keyed on clientId = userId) ───────
    //
    // VisaSupportTicket.clientId is a User id. Same multi-case caveat
    // as meetings — a client with two CRM cases will see tickets from
    // both. The ticket subject is encrypted at rest; decrypt happens
    // here, ONCE per ticket id, and the plaintext lands only in the
    // returned digest payload (never persisted).
    const tickets = clientUserId
      ? await this.prisma.visaSupportTicket.findMany({
          where:  { clientId: clientUserId },
          select: { id: true, subjectEncrypted: true },
        })
      : [];
    const ticketTopicById = new Map<string, string>();
    for (const t of tickets) {
      ticketTopicById.set(t.id, this.decryptSubject(t.subjectEncrypted as Buffer | Uint8Array | null));
    }
    const ticketRows = tickets.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'VisaSupportTicket',
            entityId:   { in: tickets.map((t) => t.id) },
            eventType:  { in: [...TICKET_EVENT_TYPES] },
            createdAt:  { gte: since, lt: until },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // ─── Build render-ready items ────────────────────────────────────
    const items: DigestItem[] = [];

    // Case-scoped events.
    for (const row of caseRows) {
      const v = (row.newValue ?? {}) as Record<string, unknown>;
      switch (row.eventType) {
        case 'INZ_SUBMITTED':
          items.push({
            type:       'INZ_SUBMITTED',
            occurredAt: row.createdAt,
            data: {
              reference: typeof v.inzApplicationNumber === 'string'
                ? v.inzApplicationNumber
                : null,
            },
          });
          break;
        case 'VISA_ISSUED':
          items.push({
            type:       'VISA_ISSUED',
            occurredAt: row.createdAt,
            data: {
              visaStartDate: typeof v.visaStartDate === 'string' ? v.visaStartDate : null,
              visaEndDate:   typeof v.visaEndDate   === 'string' ? v.visaEndDate   : null,
            },
          });
          break;
        case 'LIA_AUTO_ASSIGNED':
          items.push({
            type:       'LIA_AUTO_ASSIGNED',
            occurredAt: row.createdAt,
            data: { staffName: typeof v.liaName === 'string' ? v.liaName : null },
          });
          break;
        case 'LIA_MANUAL_REASSIGNED':
          // Reason text is internal — deliberately NOT included.
          items.push({
            type:       'LIA_MANUAL_REASSIGNED',
            occurredAt: row.createdAt,
            data: { staffName: typeof v.liaName === 'string' ? v.liaName : null },
          });
          break;
        case 'CASE_DOCUMENT_REQUESTED':
          items.push({
            type:       'CASE_DOCUMENT_REQUESTED',
            occurredAt: row.createdAt,
            data: {
              documentLabel: typeof v.requestedDocType === 'string' && v.requestedDocType.trim()
                ? v.requestedDocType
                : 'a document',
            },
          });
          break;
      }
    }

    // Payment events.
    for (const row of paymentRows) {
      const v = (row.newValue ?? {}) as Record<string, unknown>;
      const linkedPayment = row.entityId ? paymentById.get(row.entityId) : undefined;

      if (row.eventType === 'PAYMENT_RECORDED_MANUAL') {
        // newValue carries amount + currency from PaymentsService.
        const amount   = typeof v.amount   === 'number' ? v.amount   : linkedPayment?.amount   ?? 0;
        const currency = typeof v.currency === 'string' ? v.currency : linkedPayment?.currency ?? 'nzd';
        items.push({
          type:       'PAYMENT_RECORDED_MANUAL',
          occurredAt: row.createdAt,
          data: { amount, currency },
        });
      } else if (row.eventType === 'PAYMENT_VERIFICATION_CONFIRMED') {
        // The confirm audit's newValue carries hasNote: bool but NOT
        // amount/currency. We join the Payment row (already loaded) to
        // surface the receipt amount in the client digest.
        if (!linkedPayment) continue;
        items.push({
          type:       'PAYMENT_VERIFICATION_CONFIRMED',
          occurredAt: row.createdAt,
          data: { amount: linkedPayment.amount, currency: linkedPayment.currency },
        });
      }
    }

    // Document uploads — fail-safe: only INCLUDE when the actor's role
    // is a definitively-known staff role. A null/missing/unrecognised
    // role is excluded rather than risk leaking a client (or system)
    // upload back to the client as if it were staff-authored. This is
    // the polarity-flip from the original "exclude if client-role"
    // check, which silently passed null through.
    for (const row of documentRows) {
      if (!row.actorRoleSnapshot || !STAFF_ROLES.has(row.actorRoleSnapshot)) continue;
      const doc = row.entityId ? documentById.get(row.entityId) : undefined;
      if (!doc) continue;
      items.push({
        type:       'DOCUMENT_UPLOADED',
        occurredAt: row.createdAt,
        data: { documentName: doc.originalName },
      });
    }

    // Meeting events.
    for (const row of meetingRows) {
      const meeting = row.entityId ? meetingById.get(row.entityId) : undefined;
      if (!meeting) continue;
      const t = row.eventType as 'MEETING_CREATED' | 'MEETING_UPDATED' | 'MEETING_CANCELLED';
      items.push({
        type:       t,
        occurredAt: row.createdAt,
        data: { when: meeting.scheduledAt ?? null },
      });
    }

    // Ticket events.
    for (const row of ticketRows) {
      const v = (row.newValue ?? {}) as Record<string, unknown>;
      const topic = (row.entityId && ticketTopicById.get(row.entityId)) || 'a support ticket';

      if (row.eventType === 'TICKET_MESSAGE_SENT') {
        // Only staff replies. The staff path writes `byStaff: true`
        // into newValue; the client path doesn't write the flag at
        // all (and the actor will be the client themselves).
        if (v.byStaff !== true) continue;
        if (row.actorRoleSnapshot && CLIENT_ROLES.has(row.actorRoleSnapshot)) continue;
        items.push({
          type:       'TICKET_MESSAGE_SENT',
          occurredAt: row.createdAt,
          data: { ticketTopic: topic },
        });
      } else if (row.eventType === 'TICKET_STATUS_CHANGED') {
        // Staff-driven only AND only resolved/closed outcomes.
        if (v.byStaff !== true) continue;
        if (row.actorRoleSnapshot && CLIENT_ROLES.has(row.actorRoleSnapshot)) continue;
        const newStatus = typeof v.status === 'string' ? v.status : '';
        if (!TICKET_TERMINAL_STATUSES.has(newStatus)) continue;
        items.push({
          type:       'TICKET_STATUS_CHANGED',
          occurredAt: row.createdAt,
          data: { ticketTopic: topic, newStatus: newStatus as 'RESOLVED' | 'CLOSED' },
        });
      }
    }

    // Final chronological sort. The per-pass arrays were each sorted
    // ascending by orderBy, but the merged stream isn't sorted across
    // passes — fix that here.
    items.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return items;
  }

  private decryptSubject(b: Buffer | Uint8Array | null): string {
    if (!b) return 'a support ticket';
    try {
      const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
      const out = this.crypto.decrypt(buf);
      return out.trim() || 'a support ticket';
    } catch {
      // Decryption failure — surface a neutral fallback rather than
      // leaking the encrypted bytes or throwing on the whole digest.
      return 'a support ticket';
    }
  }
}
