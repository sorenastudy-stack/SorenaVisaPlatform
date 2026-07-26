import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import type { NewsletterData } from '../mail/mail.templates';

// PR-NURTURE — post-FREE_15 nurture sequence + ongoing monthly newsletter.
//
// Lifecycle (Lead.nurtureStage):
//   NONE → (staff "mark not ready") → SEQUENCE → (Day 21, no exit) → NEWSLETTER
//   any active stage → (exit condition | manual stop | unsubscribe) → ENDED
//
// The 7-touch sequence (4 emails + 3 call tasks) is deterministic from
// nurtureStartedAt. A daily cron (NurtureCronService) calls runDailySweep(); this
// service holds ALL the logic so it's unit-testable with an injected clock.
//
// Idempotency is structural, not procedural: emails dedupe on
// LeadNurtureSent(leadId, step) and call tasks on NurtureCallTask(leadId, step),
// so re-running the sweep any number of times never double-sends or double-creates
// (exactly the visa-expiry ledger pattern).

export type StaffActor = { userId: string; role: string };
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

// The 7 touches. EMAIL steps map to mail templates; CALL steps become tasks.
type Channel = 'EMAIL' | 'CALL';
interface Touch { step: number; day: number; channel: Channel; }
const SEQUENCE: readonly Touch[] = [
  { step: 1, day: 1,  channel: 'EMAIL' }, // recap
  { step: 2, day: 3,  channel: 'CALL'  },
  { step: 3, day: 6,  channel: 'EMAIL' }, // objection
  { step: 4, day: 9,  channel: 'CALL'  },
  { step: 5, day: 13, channel: 'EMAIL' }, // student story
  { step: 6, day: 17, channel: 'EMAIL' }, // honest urgency
  { step: 7, day: 21, channel: 'CALL'  }, // final attempt
];
const SEQUENCE_LENGTH_DAYS = 21;
const NEWSLETTER_INTERVAL_DAYS = 28; // ~monthly; paces the first + subsequent sends

export interface SweepResult { processed: number; emailsSent: number; callTasksCreated: number; ended: number; newslettersSent: number; }
export type NewsletterContent = Pick<NewsletterData, 'blog' | 'video' | 'webinars'>;

@Injectable()
export class NurtureService {
  private readonly logger = new Logger(NurtureService.name);
  private readonly frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── Staff actions ──────────────────────────────────────────────────────

  // "Mark not ready" — enrol a lead that completed its FREE_15 but didn't commit.
  async enroll(leadId: string, reason: string | null, _actor: StaffActor): Promise<{ ok: true }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nurtureStage: true, nurtureUnsubscribedAt: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.nurtureUnsubscribedAt) {
      throw new ConflictException('This lead has unsubscribed from nurture emails and cannot be re-enrolled.');
    }
    if (lead.nurtureStage === 'SEQUENCE' || lead.nurtureStage === 'NEWSLETTER') {
      throw new ConflictException('This lead is already in an active nurture sequence.');
    }
    // Precondition: a completed free 15-minute consultation.
    const free15 = await this.prisma.consultation.findFirst({
      where: { leadId, type: 'FREE_15', status: 'COMPLETED' },
      select: { id: true },
    });
    if (!free15) {
      throw new UnprocessableEntityException('This lead hasn’t completed a free consultation yet.');
    }
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        nurtureStage: 'SEQUENCE',
        nurtureStartedAt: new Date(),
        nurtureReason: reason,
        nurtureUnsubToken: randomBytes(24).toString('hex'),
        nurtureLastNewsletterAt: null,
        // A "not ready" lead's CRM status IS nurture — set directly (system action).
        leadStatus: 'NURTURE',
      },
    });
    return { ok: true };
  }

  // Manual stop (e.g. the lead replied directly). Ends the sequence + closes any
  // open call tasks. Idempotent.
  async stopNurture(leadId: string, _actor: StaffActor): Promise<{ ok: true }> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead not found');
    await this.endEnrollment(leadId);
    return { ok: true };
  }

  // PR-CO-KANBAN — CO manual override of the automated nurture cadence. PRE-CONTRACT
  // ONLY (rejected once a contract exists). A short reason is mandatory and BOTH
  // directions are written to the audit log so OWNER/ADMIN can review who is
  // accelerating/delaying leads and why.
  //   • ADVANCE  — end automated nurturing early + ready the lead for referral
  //                (stage → ENDED, any hold cleared).
  //   • POSTPONE — hold nurturing for a chosen number of days (nurtureHeldUntil =
  //                now + days); the daily sweep skips the lead until then.
  async manualOverride(
    leadId: string,
    direction: 'ADVANCE' | 'POSTPONE',
    reason: string,
    holdDays: number | null,
    actor: StaffActor & { name?: string | null },
    now: Date = new Date(),
  ): Promise<{ ok: true; nurtureHeldUntil?: Date }> {
    if (!reason || !reason.trim()) throw new BadRequestException('A short reason is required.');

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nurtureStage: true, nurtureHeldUntil: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Pre-contract only — reject if a contract already exists (lead- or case-based).
    const contract = await this.prisma.contract.findFirst({
      where: { OR: [{ leadId }, { case: { leadId } }] },
      select: { id: true },
    });
    if (contract) {
      throw new ConflictException('This lead already has a contract — overrides apply pre-contract only.');
    }

    if (direction === 'ADVANCE') {
      const from = lead.nurtureStage;
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { nurtureStage: 'ENDED', nurtureHeldUntil: null, nurtureHoldReason: null },
      });
      await this.writeOverrideAudit('NURTURE_MANUALLY_ADVANCED', leadId, { from, to: 'ENDED', reason }, actor);
      return { ok: true };
    }

    // POSTPONE — a bounded hold, not an indefinite suspension.
    if (!holdDays || holdDays < 1) throw new BadRequestException('Postpone needs a number of days (≥ 1).');
    const until = this.addDays(now, holdDays);
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { nurtureHeldUntil: until, nurtureHoldReason: reason },
    });
    await this.writeOverrideAudit('NURTURE_MANUALLY_POSTPONED', leadId, {
      from: lead.nurtureHeldUntil, to: until, reason, holdDays,
    }, actor);
    return { ok: true, nurtureHeldUntil: until };
  }

  private async writeOverrideAudit(
    eventType: string, leadId: string, newValue: Record<string, unknown>, actor: StaffActor & { name?: string | null },
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: actor.userId ?? null,
        action: 'UPDATE',
        eventType,
        entityType: 'LEAD',
        entityId: leadId,
        newValue: newValue as any,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });
  }

  // ─── Client action (public, token-gated) ────────────────────────────────

  // Permanent EMAIL unsubscribe. Sets the master kill-switch that the sweep
  // checks before every email + newsletter send. Marketing-emails-ONLY:
  //   • It does NOT end the enrolment (stage is untouched) and does NOT cancel or
  //     touch pending Client Officer call tasks — a phone call is not email
  //     marketing, so the CO stays free to call, and the remaining scheduled
  //     calls still get created by the sweep.
  //   • It DOES permanently stop all nurture + newsletter emails.
  // Idempotent.
  async unsubscribe(token: string): Promise<{ ok: true }> {
    if (!token) throw new NotFoundException('Invalid unsubscribe link');
    const lead = await this.prisma.lead.findUnique({
      where: { nurtureUnsubToken: token },
      select: { id: true, nurtureUnsubscribedAt: true },
    });
    if (!lead) throw new NotFoundException('Invalid unsubscribe link');
    if (lead.nurtureUnsubscribedAt) return { ok: true }; // already unsubscribed
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { nurtureUnsubscribedAt: new Date() },
    });
    return { ok: true };
  }

  // ─── Staff "My follow-ups" surface ──────────────────────────────────────

  async listMyCallTasks(actor: StaffActor) {
    const isAdmin = ADMIN_TIER.has(actor.role);
    const tasks = await this.prisma.nurtureCallTask.findMany({
      where: { status: 'PENDING', ...(isAdmin ? {} : { assignedToId: actor.userId }) },
      orderBy: { dueDate: 'asc' },
      include: {
        lead: { select: { id: true, clientId: true, nurtureReason: true, contact: { select: { fullName: true, email: true } } } },
        assignedTo: { select: { name: true } },
      },
    });
    return tasks.map((t) => ({
      id: t.id,
      step: t.step,
      dueDate: t.dueDate,
      leadId: t.leadId,
      clientId: t.lead?.clientId ?? null,
      clientName: t.lead?.contact?.fullName ?? null,
      clientEmail: t.lead?.contact?.email ?? null,
      reason: t.lead?.nurtureReason ?? null,
      assignedToName: t.assignedTo?.name ?? null,
    }));
  }

  async completeCallTask(
    taskId: string,
    actor: StaffActor,
    status: 'DONE' | 'SKIPPED',
    outcomeNotes: string | null,
  ): Promise<{ ok: true }> {
    if (status !== 'DONE' && status !== 'SKIPPED') {
      throw new BadRequestException("status must be 'DONE' or 'SKIPPED'");
    }
    const task = await this.prisma.nurtureCallTask.findUnique({
      where: { id: taskId },
      select: { id: true, assignedToId: true, status: true },
    });
    if (!task) throw new NotFoundException('Call task not found');
    const isAdmin = ADMIN_TIER.has(actor.role);
    if (!isAdmin && task.assignedToId !== actor.userId) {
      throw new ForbiddenException('Only the assigned Client Officer or an admin can action this task.');
    }
    if (task.status !== 'PENDING') {
      throw new ConflictException(`This task is already ${task.status.toLowerCase()}.`);
    }
    await this.prisma.nurtureCallTask.update({
      where: { id: taskId },
      data: { status, outcomeNotes, completedAt: new Date(), completedById: actor.userId },
    });
    return { ok: true };
  }

  // ─── Daily cron workhorse ───────────────────────────────────────────────

  async runDailySweep(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = { processed: 0, emailsSent: 0, callTasksCreated: 0, ended: 0, newslettersSent: 0 };
    const leads = await this.prisma.lead.findMany({
      // Unsubscribed leads are STILL processed — unsubscribe stops emails only, so
      // the sweep must keep creating their scheduled call tasks. The email/
      // newsletter sends are muted per-send in processLead (checked before every
      // send). nurtureStartedAt is always set for an active stage.
      // PR-CO-KANBAN — a CO "postpone" holds the lead: skip it entirely while
      // nurtureHeldUntil is in the future (resumes automatically once it passes).
      where: {
        nurtureStage: { in: ['SEQUENCE', 'NEWSLETTER'] },
        OR: [{ nurtureHeldUntil: null }, { nurtureHeldUntil: { lte: now } }],
      },
      select: {
        id: true, nurtureStage: true, nurtureStartedAt: true, nurtureLastNewsletterAt: true,
        nurtureUnsubToken: true, nurtureUnsubscribedAt: true, leadStatus: true,
        contact: { select: { email: true, fullName: true } },
      },
    });

    for (const lead of leads) {
      result.processed++;
      try {
        await this.processLead(lead, now, result);
      } catch (err: any) {
        this.logger.error(`[Nurture] lead ${lead.id} failed: ${err?.message ?? err}`, err?.stack);
      }
    }
    return result;
  }

  private async processLead(
    lead: {
      id: string; nurtureStage: string; nurtureStartedAt: Date | null;
      nurtureLastNewsletterAt: Date | null; nurtureUnsubToken: string | null;
      nurtureUnsubscribedAt: Date | null; leadStatus: string;
      contact: { email: string | null; fullName: string | null } | null;
    },
    now: Date,
    result: SweepResult,
  ): Promise<void> {
    if (!lead.nurtureStartedAt) return;
    // Marketing-emails-only opt-out: an unsubscribed lead still gets its call
    // tasks created, but no email or newsletter is ever sent.
    const emailsMuted = lead.nurtureUnsubscribedAt !== null;

    // 1. Exit conditions — checked BEFORE any send. Any hit ends everything.
    const exit = await this.detectExit(lead.id, lead.nurtureStartedAt, lead.leadStatus);
    if (exit) {
      await this.endEnrollment(lead.id);
      result.ended++;
      this.logger.log(`[Nurture] lead ${lead.id} ended (${exit})`);
      return;
    }

    const email = lead.contact?.email ?? null;
    const name = lead.contact?.fullName ?? null;
    const unsubscribeUrl = `${this.frontendUrl}/unsubscribe?token=${lead.nurtureUnsubToken ?? ''}`;
    const ctaUrl = `${this.frontendUrl}/portal`;

    // 2. SEQUENCE — send due emails + create due call tasks.
    let stage = lead.nurtureStage;
    if (stage === 'SEQUENCE') {
      for (const touch of SEQUENCE) {
        const due = this.addDays(lead.nurtureStartedAt, touch.day);
        if (now.getTime() < due.getTime()) continue; // not due yet
        if (touch.channel === 'EMAIL') {
          if (emailsMuted) continue; // unsubscribed — skip the email, keep going
          const sent = await this.ensureEmailSent(lead.id, touch.step, email, name, ctaUrl, unsubscribeUrl);
          if (sent) result.emailsSent++;
        } else {
          // Call tasks are NOT marketing email — created regardless of unsubscribe.
          const created = await this.ensureCallTask(lead.id, touch.step, due);
          if (created) result.callTasksCreated++;
        }
      }
      // Day 21 reached with no exit → transition to the indefinite newsletter.
      if (now.getTime() >= this.addDays(lead.nurtureStartedAt, SEQUENCE_LENGTH_DAYS).getTime()) {
        await this.prisma.lead.update({ where: { id: lead.id }, data: { nurtureStage: 'NEWSLETTER' } });
        stage = 'NEWSLETTER';
      }
    }

    // 3. NEWSLETTER — monthly cadence (muted for unsubscribed leads).
    if (stage === 'NEWSLETTER' && !emailsMuted) {
      const sent = await this.maybeSendNewsletter(lead.id, lead.nurtureStartedAt, lead.nurtureLastNewsletterAt, email, name, ctaUrl, unsubscribeUrl, now);
      if (sent) result.newslettersSent++;
    }
  }

  // Exit condition: a contract now exists (lead- or case-based), a NEW consultation
  // was booked after enrolment, or the lead was marked QUALIFIED/DISQUALIFIED.
  private async detectExit(leadId: string, startedAt: Date, leadStatus: string): Promise<string | null> {
    if (leadStatus === 'QUALIFIED' || leadStatus === 'DISQUALIFIED') return 'STATUS_CHANGED';
    const contract = await this.prisma.contract.findFirst({
      where: { OR: [{ leadId }, { case: { leadId } }] },
      select: { id: true },
    });
    if (contract) return 'CONTRACT_EXISTS';
    const newConsult = await this.prisma.consultation.findFirst({
      where: { leadId, createdAt: { gt: startedAt } },
      select: { id: true },
    });
    if (newConsult) return 'NEW_CONSULTATION';
    return null;
  }

  private async endEnrollment(leadId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.lead.update({ where: { id: leadId }, data: { nurtureStage: 'ENDED' } }),
      this.prisma.nurtureCallTask.updateMany({
        where: { leadId, status: 'PENDING' },
        data: { status: 'AUTO_CLOSED' },
      }),
    ]);
  }

  // Idempotent email send: ledger row is the dedup anchor (unique leadId+step).
  private async ensureEmailSent(
    leadId: string, step: number, email: string | null, name: string | null, ctaUrl: string, unsubscribeUrl: string,
  ): Promise<boolean> {
    const existing = await this.prisma.leadNurtureSent.findUnique({
      where: { uniq_lead_nurture_step: { leadId, step: String(step) } },
    });
    if (existing) return false;
    const ok = email ? await this.mail.sendNurtureSequenceEmail(email, step, { name, ctaUrl, unsubscribeUrl }) : false;
    try {
      await this.prisma.leadNurtureSent.create({
        data: { leadId, step: String(step), emailDeliveryStatus: ok ? 'SENT' : 'FAILED', emailErrorMessage: email ? null : 'no-email' },
      });
    } catch {
      // Unique violation — a concurrent sweep already recorded it. Not a re-send.
      return false;
    }
    return ok;
  }

  // Idempotent call-task creation: unique leadId+step. Assignee = the Client
  // Officer who ran the FREE_15 (Consultation.assignedToId).
  private async ensureCallTask(leadId: string, step: number, dueDate: Date): Promise<boolean> {
    const existing = await this.prisma.nurtureCallTask.findUnique({
      where: { uniq_lead_call_step: { leadId, step } },
    });
    if (existing) return false;
    const free15 = await this.prisma.consultation.findFirst({
      where: { leadId, type: 'FREE_15', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { assignedToId: true },
    });
    try {
      await this.prisma.nurtureCallTask.create({
        data: { leadId, step, dueDate, assignedToId: free15?.assignedToId ?? null, status: 'PENDING' },
      });
    } catch {
      return false; // unique violation under concurrency
    }
    return true;
  }

  // Monthly newsletter. First eligible after Day 21; then every ~28 days. Sends
  // only when at least one content slot is present — never a broken empty email.
  private async maybeSendNewsletter(
    leadId: string, startedAt: Date, lastNewsletterAt: Date | null,
    email: string | null, name: string | null, ctaUrl: string, unsubscribeUrl: string, now: Date,
  ): Promise<boolean> {
    const dueAt = lastNewsletterAt
      ? this.addDays(lastNewsletterAt, NEWSLETTER_INTERVAL_DAYS)
      : this.addDays(startedAt, SEQUENCE_LENGTH_DAYS);
    if (now.getTime() < dueAt.getTime()) return false;

    const content = await this.getNewsletterContent(now);
    const hasContent = !!content.blog || !!content.video?.youtubeUrl || !!(content.webinars && content.webinars.length);
    if (!hasContent) return false; // graceful: nothing to say this month → don't send

    const monthKey = `NL-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing = await this.prisma.leadNurtureSent.findUnique({
      where: { uniq_lead_nurture_step: { leadId, step: monthKey } },
    });
    if (existing) return false;

    const ok = email
      ? await this.mail.sendNurtureNewsletter(email, { name, ctaUrl, unsubscribeUrl, ...content })
      : false;
    try {
      await this.prisma.$transaction([
        this.prisma.leadNurtureSent.create({
          data: { leadId, step: monthKey, emailDeliveryStatus: ok ? 'SENT' : 'FAILED', emailErrorMessage: email ? null : 'no-email' },
        }),
        this.prisma.lead.update({ where: { id: leadId }, data: { nurtureLastNewsletterAt: now } }),
      ]);
    } catch {
      return false;
    }
    return ok;
  }

  // Newsletter content source. Empty by default (capability built; the blog /
  // video / webinar wiring is TBD). Overridable in tests + when a content source
  // is added later. Kept protected so it's the single seam for "what goes out".
  protected async getNewsletterContent(_now: Date): Promise<NewsletterContent> {
    return { blog: null, video: null, webinars: null };
  }

  private addDays(d: Date, n: number): Date {
    return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
  }
}
