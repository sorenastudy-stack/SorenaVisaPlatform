import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, VisaExpiryReminderRecipient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// PR-LIA-9 — Visa expiry reminder sweep.
//
// Single source of truth: VisaExpiryReminderSent. The daily cron at
// 09:00 NZ scans Visa rows with outcome=APPROVED whose visaEndDate
// falls exactly on one of the [30, 14, 7]-day-ahead anchor dates and
// fires one reminder per (LIA | CLIENT | OWNER) recipient. The
// (visaId, thresholdDays, recipient) UNIQUE constraint makes the
// loop idempotent — re-runs skip already-sent reminders.
//
// Email is best-effort. We:
//   * always write the audit row (intent)
//   * always write the VisaExpiryReminderSent ledger row (outcome
//     tracking, deduplication anchor)
//   * try the email send and update emailDeliveryStatus to SENT or
//     FAILED depending on outcome
// Failed sends don't abort the sweep. A retry on the next day's
// run will see the existing ledger row (UNIQUE) and skip — so a
// transient SMTP failure is recorded but not retried automatically.
// That's deliberate: the OWNER eyes-on UI surfaces FAILED rows and
// a manual sweep can clean up after the underlying cause is fixed.

const THRESHOLDS = [30, 14, 7] as const;
const TIMEZONE = 'Pacific/Auckland';

export interface SweepActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
}

export interface SweepResult {
  dispatched: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class VisaExpiryService {
  private readonly logger = new Logger(VisaExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Cron entrypoint ───────────────────────────────────────────────────

  @Cron('0 9 * * *', {
    name: 'visaExpiryDailySweep',
    timeZone: TIMEZONE,
  })
  async runDailySweep(): Promise<void> {
    this.logger.log('[VisaExpiry] Daily sweep started');
    try {
      const r = await this.dispatchRemindersForThresholds([...THRESHOLDS]);
      this.logger.log(
        `[VisaExpiry] Dispatched ${r.dispatched} reminders, skipped ${r.skipped} duplicates, ${r.failed} failed`,
      );
    } catch (err: any) {
      // Never throw out of the cron — if we did, the scheduler would
      // log + carry on but we'd lose context. Log the stack here.
      this.logger.error(
        `[VisaExpiry] Daily sweep crashed: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  // ─── Workhorse ─────────────────────────────────────────────────────────

  async dispatchRemindersForThresholds(
    thresholds: number[],
    actor: SweepActor = {},
  ): Promise<SweepResult> {
    let dispatched = 0;
    let skipped = 0;
    let failed = 0;

    for (const t of thresholds) {
      const { start, end } = this.dayWindow(t);
      const visas = await this.prisma.visa.findMany({
        where: {
          outcome: 'APPROVED',
          visaEndDate: { gte: start, lte: end },
        },
        include: {
          case: {
            include: {
              lead: { include: { contact: true } },
              lia: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });

      // OWNER recipient fans out across every active OWNER user. We
      // fetch them once per threshold pass (no need per-visa).
      const owners = await this.prisma.user.findMany({
        where: { role: 'OWNER', isActive: true },
        select: { id: true, name: true, email: true },
      });

      for (const v of visas) {
        for (const recipient of ['LIA', 'CLIENT', 'OWNER'] as const) {
          const existing = await this.prisma.visaExpiryReminderSent.findUnique({
            where: {
              uniq_visa_threshold_recipient: {
                visaId: v.id,
                thresholdDays: t,
                recipient: recipient as VisaExpiryReminderRecipient,
              },
            },
          });
          if (existing) {
            skipped++;
            await this.writeAudit(
              'VISA_EXPIRY_REMINDER_SKIPPED',
              v.caseId,
              {
                visaId: v.id,
                thresholdDays: t,
                recipient,
                reason: 'already-sent',
                existingSentAt: existing.sentAt.toISOString(),
              },
              actor,
            );
            continue;
          }

          const dispatchOutcome = await this.dispatchOne(v, t, recipient, owners);

          if (dispatchOutcome.recordedUserIds.length === 0) {
            // No-op (e.g. no email on file). Still record a ledger row
            // so we don't keep retrying the same day every sweep.
            await this.prisma.visaExpiryReminderSent.create({
              data: {
                visaId: v.id,
                thresholdDays: t,
                recipient: recipient as VisaExpiryReminderRecipient,
                recipientUserId: null,
                emailDeliveryStatus: 'FAILED',
                emailErrorMessage: dispatchOutcome.errorMessage ?? 'no-recipient',
              },
            });
            failed++;
          } else {
            // We send up to N emails for OWNER, but record ONE ledger
            // row (per the spec — the unique key makes per-recipient
            // rows impossible anyway). For LIA/CLIENT it's already 1:1.
            await this.prisma.visaExpiryReminderSent.create({
              data: {
                visaId: v.id,
                thresholdDays: t,
                recipient: recipient as VisaExpiryReminderRecipient,
                recipientUserId:
                  recipient === 'OWNER'
                    ? null
                    : dispatchOutcome.recordedUserIds[0] ?? null,
                emailDeliveryStatus: dispatchOutcome.allSucceeded ? 'SENT' : 'FAILED',
                emailErrorMessage: dispatchOutcome.errorMessage,
              },
            });
            if (dispatchOutcome.allSucceeded) dispatched++;
            else failed++;
          }

          await this.writeAudit(
            `VISA_EXPIRY_REMINDER_SENT_${recipient}`,
            v.caseId,
            {
              visaId: v.id,
              thresholdDays: t,
              recipient,
              recipientCount: dispatchOutcome.recordedUserIds.length,
              emailDeliveryStatus: dispatchOutcome.allSucceeded ? 'SENT' : 'FAILED',
            },
            actor,
          );
        }
      }
    }

    return { dispatched, skipped, failed };
  }

  // ─── Dashboard query ───────────────────────────────────────────────────

  async getExpiringSoon(thresholdDays: number = 30) {
    const now = new Date();
    const end = new Date(now.getTime() + thresholdDays * 86_400_000);

    const visas = await this.prisma.visa.findMany({
      where: {
        outcome: 'APPROVED',
        // Include already-expired (visaEndDate < now) so the page can
        // also show expired-but-not-renewed cases. Clamp at the upper
        // end with `lte: end` so we don't blast back 10-year-old rows.
        visaEndDate: { lte: end },
      },
      include: {
        case: {
          include: {
            lead: { include: { contact: true } },
            lia: { select: { id: true, name: true, email: true } },
          },
        },
        expiryReminders: {
          select: {
            thresholdDays: true,
            recipient: true,
            sentAt: true,
            emailDeliveryStatus: true,
          },
        },
      },
      orderBy: { visaEndDate: 'asc' },
    });

    return visas.map((v) => {
      const daysRemaining = v.visaEndDate
        ? Math.floor((v.visaEndDate.getTime() - now.getTime()) / 86_400_000)
        : null;
      const remindersSent = {
        thirtyDay: v.expiryReminders.some((r) => r.thresholdDays === 30 && r.emailDeliveryStatus === 'SENT'),
        fourteenDay: v.expiryReminders.some((r) => r.thresholdDays === 14 && r.emailDeliveryStatus === 'SENT'),
        sevenDay: v.expiryReminders.some((r) => r.thresholdDays === 7 && r.emailDeliveryStatus === 'SENT'),
      };
      return {
        visaId: v.id,
        caseId: v.caseId,
        applicantName: v.case.lead?.contact?.fullName ?? null,
        applicantEmail: v.case.lead?.contact?.email ?? null,
        visaStartDate: v.visaStartDate?.toISOString() ?? null,
        visaEndDate: v.visaEndDate?.toISOString() ?? null,
        daysRemaining,
        liaId: v.case.lia?.id ?? null,
        liaName: v.case.lia?.name ?? null,
        liaEmail: v.case.lia?.email ?? null,
        remindersSent,
      };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  // Returns the UTC instants that bracket the day exactly
  // `thresholdDays` from "today at midnight NZ time". The query is
  // visaEndDate >= start && visaEndDate <= end — so a visa whose
  // endDate falls inside that 24-hour window matches.
  //
  // We deliberately stay in UTC for the storage comparison; the
  // anchor (today's date in NZ) is the only timezone-sensitive bit.
  // node's built-in Intl.DateTimeFormat resolves to the configured
  // tz reliably across Linux, macOS, and Windows.
  private dayWindow(thresholdDays: number): { start: Date; end: Date } {
    const nowNz = this.todayInNz();
    const target = new Date(nowNz.getTime() + thresholdDays * 86_400_000);
    const start = new Date(target);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(target);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }

  // Returns "today at 00:00:00 in Pacific/Auckland" as a UTC Date.
  private todayInNz(): Date {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    const y = parseInt(get('year'), 10);
    const m = parseInt(get('month'), 10) - 1;
    const d = parseInt(get('day'), 10);
    return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  }

  // Returns the list of user IDs we sent to (so we can record one in
  // the ledger; OWNER fan-outs return all OWNER ids). Plus a flag
  // saying whether every send succeeded.
  private async dispatchOne(
    v: Awaited<ReturnType<VisaExpiryService['fetchVisaWithCase']>>[number],
    threshold: number,
    recipient: 'LIA' | 'CLIENT' | 'OWNER',
    owners: Array<{ id: string; name: string; email: string }>,
  ): Promise<{
    recordedUserIds: string[];
    allSucceeded: boolean;
    errorMessage: string | null;
  }> {
    const clientName = v.case.lead?.contact?.fullName ?? 'there';
    const visaEnd = v.visaEndDate ?? new Date();
    const daysRemaining = Math.max(
      0,
      Math.floor((visaEnd.getTime() - Date.now()) / 86_400_000),
    );

    if (recipient === 'LIA') {
      const liaEmail = v.case.lia?.email ?? null;
      const liaName = v.case.lia?.name ?? null;
      const liaId = v.case.lia?.id ?? null;
      if (!liaEmail || !liaId) {
        return { recordedUserIds: [], allSucceeded: false, errorMessage: 'no-lia-on-case' };
      }
      const ok = await this.safeSend(() =>
        this.notifications.sendVisaExpiryReminderToLia(
          liaEmail,
          liaName ?? 'there',
          clientName,
          v.caseId,
          visaEnd,
          daysRemaining,
          threshold,
        ),
      );
      return {
        recordedUserIds: [liaId],
        allSucceeded: ok.ok,
        errorMessage: ok.error,
      };
    }

    if (recipient === 'CLIENT') {
      const clientEmail = v.case.lead?.contact?.email ?? null;
      const clientUserId = v.case.lead?.contact?.userId ?? null;
      if (!clientEmail) {
        return { recordedUserIds: [], allSucceeded: false, errorMessage: 'no-client-email' };
      }
      const ok = await this.safeSend(() =>
        this.notifications.sendVisaExpiryReminderToClient(
          clientEmail,
          clientName,
          visaEnd,
          daysRemaining,
          threshold,
        ),
      );
      return {
        recordedUserIds: clientUserId ? [clientUserId] : ['anonymous'],
        allSucceeded: ok.ok,
        errorMessage: ok.error,
      };
    }

    // OWNER fan-out
    if (owners.length === 0) {
      return { recordedUserIds: [], allSucceeded: false, errorMessage: 'no-owners-on-system' };
    }
    const errors: string[] = [];
    const succeeded: string[] = [];
    for (const o of owners) {
      const ok = await this.safeSend(() =>
        this.notifications.sendVisaExpiryReminderToOwner(
          o.email,
          o.name,
          clientName,
          v.case.lia?.name ?? null,
          v.caseId,
          visaEnd,
          daysRemaining,
          threshold,
        ),
      );
      if (ok.ok) succeeded.push(o.id);
      else if (ok.error) errors.push(`${o.email}: ${ok.error}`);
    }
    return {
      recordedUserIds: succeeded.length > 0 ? succeeded : owners.map((o) => o.id),
      allSucceeded: errors.length === 0,
      errorMessage: errors.length === 0 ? null : errors.join('; '),
    };
  }

  private async safeSend(
    fn: () => Promise<void>,
  ): Promise<{ ok: boolean; error: string | null }> {
    try {
      await fn();
      return { ok: true, error: null };
    } catch (err: any) {
      this.logger.error(`[VisaExpiry] Email send failed: ${err?.message ?? err}`);
      return { ok: false, error: err?.message ?? 'unknown-send-error' };
    }
  }

  private async writeAudit(
    eventType: string,
    caseId: string,
    payload: Record<string, unknown>,
    actor: SweepActor,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id ?? null,
          action: eventType.startsWith('VISA_EXPIRY_REMINDER_SENT') ? 'CREATE' : 'READ',
          eventType,
          entityType: 'CASE',
          entityId: caseId,
          newValue: payload as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? 'SYSTEM',
        },
      });
    } catch (err: any) {
      // Audit failure is logged but does NOT abort the sweep — the
      // delivery ledger row carries the durable trail of intent.
      this.logger.error(`[VisaExpiry] Failed to write audit row: ${err?.message ?? err}`);
    }
  }

  // Type helper for dispatchOne — Prisma's generated type for the
  // visa-with-case include is unwieldy to spell inline, so we resolve
  // it via ReturnType<fetchVisaWithCase>.
  private async fetchVisaWithCase() {
    return this.prisma.visa.findMany({
      where: {},
      include: {
        case: {
          include: {
            lead: { include: { contact: true } },
            lia: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }
}
