import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CaseSlot, HandoffState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { hasRole } from '../auth/role.util';

// PR-HANDOFF — moving a case from one stage to the next, on purpose.
//
// The existing Handoffs page infers a problem from state: a slot still empty
// past the point it should have been filled. That is a safety net and stays.
// This is the deliberate act it was compensating for.

/** The stages in order. A case moves forward through these and nowhere else. */
export const SLOT_ORDER: CaseSlot[] = ['ADMISSION', 'SUPPORT', 'FINANCE', 'LIA'];

/** Which Case column each stage owns. */
export const SLOT_FIELD: Record<CaseSlot, 'ownerId' | 'supportId' | 'financeId' | 'liaId'> = {
  ADMISSION: 'ownerId',
  SUPPORT: 'supportId',
  FINANCE: 'financeId',
  LIA: 'liaId',
};

/** Human names, for emails and notification copy. */
export const SLOT_LABEL: Record<CaseSlot, string> = {
  ADMISSION: 'Admission',
  SUPPORT: 'Student Support',
  FINANCE: 'Finance',
  LIA: 'Immigration Adviser',
};

/** Roles that may hand off any case regardless of which slot they hold. */
const OVERRIDE_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];

/** How many handoffs a page shows. The table keeps everything. */
const RECENT_LIMIT = 50;

/** How close together two handoffs to the same stage count as one double-click. */
const DUPLICATE_WINDOW_MS = 60_000;

export interface HandoffActor {
  id: string;
  name?: string | null;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
}

@Injectable()
export class CaseHandoffService {
  private readonly logger = new Logger(CaseHandoffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: LiaAssignmentService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The stage after this one, or null at the end of the line. */
  static nextSlot(from: CaseSlot): CaseSlot | null {
    const i = SLOT_ORDER.indexOf(from);
    return i >= 0 && i < SLOT_ORDER.length - 1 ? SLOT_ORDER[i + 1]! : null;
  }

  /**
   * Hand a case to the next stage.
   *
   * The caller must currently hold `fromSlot` on this case. That check is the
   * point of the endpoint: without it, anyone entitled to the route could push
   * work into a colleague's queue on a case they have never touched, and the
   * record would name them as the sender. Admin tier can act on any case, since
   * unsticking someone else's is exactly their job.
   */
  async handOff(
    caseId: string,
    fromSlot: CaseSlot,
    actor: HandoffActor,
    opts: { toUserId?: string | null; note?: string | null } = {},
  ) {
    const toSlot = CaseHandoffService.nextSlot(fromSlot);
    if (!toSlot) {
      throw new BadRequestException(
        `${SLOT_LABEL[fromSlot]} is the final stage — there is nothing to hand off to.`,
      );
    }

    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true, ownerId: true, supportId: true, financeId: true, liaId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    if (!kase) throw new NotFoundException('Case not found');

    const holder = (kase as any)[SLOT_FIELD[fromSlot]] as string | null;
    const isOverride = hasRole(actor, ...OVERRIDE_ROLES);
    if (!isOverride && holder !== actor.id) {
      // Not-found would be wrong here: the caller can see this case, they just
      // do not hold the stage they are trying to hand off from.
      throw new ForbiddenException(
        `You do not currently hold the ${SLOT_LABEL[fromSlot]} stage on this case.`,
      );
    }

    // Double-click guard.
    //
    // This used to key off status PENDING, which stopped working the moment
    // handoffs became accepted on creation — nothing is ever pending, so the
    // check silently matched nothing and every click made a row.
    //
    // It is a time window instead, because "already handed to this stage" is no
    // longer a state that persists. A double-click lands within seconds; a
    // genuine re-handoff — a case that went forward, came back, and is being
    // passed on again — is minutes or days later and must still be recorded.
    const justNow = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const duplicate = await this.prisma.caseHandoff.findFirst({
      where: { caseId, toSlot, createdAt: { gte: justNow } },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) return duplicate;

    const toUserId = await this.resolveRecipient(caseId, toSlot, opts.toUserId ?? null, actor);
    const toUser = toUserId
      ? await this.prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true, email: true } })
      : null;

    // Accepted on creation. Nobody waits on anybody: the case has already moved
    // to the next slot and the recipient has already been told, so a separate
    // human acknowledgement would only have recorded how long someone took to
    // click a button. firstViewedAt measures that better, without blocking.
    //
    // acceptedAt is the row's own createdAt rather than a second new Date(), so
    // the two are identical by construction — a few milliseconds of drift would
    // show up as real latency in a report built on these columns.
    const now = new Date();
    const handoff = await this.prisma.caseHandoff.create({
      data: {
        caseId, fromSlot, toSlot,
        fromUserId: actor.id,
        fromUserName: actor.name ?? null,
        toUserId: toUser?.id ?? null,
        toUserName: toUser?.name ?? null,
        note: opts.note?.trim() || null,
        status: HandoffState.ACCEPTED,
        createdAt: now,
        acceptedAt: now,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'UPDATE',
        eventType: 'CASE_HANDED_OFF',
        entityType: 'CASE',
        entityId: caseId,
        newValue: {
          handoffId: handoff.id, fromSlot, toSlot, toUserId: toUser?.id ?? null,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    }).catch(() => { /* audit is best-effort; never block the handoff */ });

    const clientName = kase.lead?.contact?.fullName ?? 'a client';
    if (toUser) await this.notify(toUser, handoff.id, caseId, clientName, fromSlot, toSlot, actor);
    else {
      // Nobody to hand to. The handoff still exists and shows on the oversight
      // page as unassigned — silently dropping it would hide the gap.
      this.logger.warn(
        `[handoff] case ${caseId} → ${toSlot}: no active staff to receive it; left unassigned`,
      );
    }

    return handoff;
  }

  /**
   * Who receives it.
   *
   * Default is the existing load-balancing assignment — the same function that
   * fills the slot automatically elsewhere, so a handoff and an auto-assignment
   * cannot disagree about who is least loaded. An explicit toUserId overrides
   * it, and also fills the slot, so the two never drift apart.
   */
  private async resolveRecipient(
    caseId: string,
    toSlot: CaseSlot,
    explicitUserId: string | null,
    actor: HandoffActor,
  ): Promise<string | null> {
    if (explicitUserId) {
      const target = await this.prisma.user.findUnique({
        where: { id: explicitUserId },
        select: { id: true, isActive: true },
      });
      if (!target || !target.isActive) {
        throw new BadRequestException('That person cannot receive a handoff (unknown or inactive).');
      }
      await this.prisma.case.update({
        where: { id: caseId },
        data: { [SLOT_FIELD[toSlot]]: explicitUserId } as any,
      });
      return explicitUserId;
    }

    const trigger = { id: actor.id, name: actor.name ?? null, role: actor.role ?? null };
    switch (toSlot) {
      case 'SUPPORT':  return (await this.assignments.assignPastoralCareToCase(caseId, trigger as any)).supportId ?? null;
      case 'FINANCE':  return (await this.assignments.assignFinanceToCase(caseId, trigger as any)).financeId ?? null;
      case 'LIA':      return (await this.assignments.assignLiaToCase(caseId, trigger as any)).liaId ?? null;
      // ADMISSION is never a handoff TARGET — it is the first stage — but the
      // switch stays exhaustive so a future reorder cannot fall through silently.
      case 'ADMISSION': return (await this.assignments.assignAdmissionToCase(caseId, trigger as any)).ownerId ?? null;
    }
  }

  /** Email + in-app, both best-effort: a failed notification must not undo a handoff. */
  private async notify(
    toUser: { id: string; name: string | null; email: string },
    handoffId: string,
    caseId: string,
    clientName: string,
    fromSlot: CaseSlot,
    toSlot: CaseSlot,
    actor: HandoffActor,
  ) {
    const fromName = actor.name ?? 'A colleague';
    await this.notifications.create({
      userId: toUser.id,
      type: 'CASE_HANDOFF',
      title: `${clientName} handed to you`,
      body: `${fromName} passed this case from ${SLOT_LABEL[fromSlot]} to ${SLOT_LABEL[toSlot]}.`,
      link: '/staff/handoffs/my-queue',
    }).catch((e) => this.logger.error(`[handoff] in-app notify failed: ${e?.message ?? e}`));

    await this.mail.sendCaseHandoff(
      toUser.email, toUser.name ?? 'there', caseId, clientName, fromName, SLOT_LABEL[toSlot],
    ).catch((e) => this.logger.error(`[handoff] email failed: ${e?.message ?? e}`));
  }

  /**
   * Cases recently handed to this person.
   *
   * No longer a queue of things to action — handoffs are accepted on creation,
   * so there is nothing pending. It answers "what landed on my desk lately",
   * newest first, which is what a recipient actually opens this page for.
   */
  async myQueue(userId: string, limit = RECENT_LIMIT) {
    return this.prisma.caseHandoff.findMany({
      where: { toUserId: userId },
      // createdAt then id: two handoffs made in the same millisecond would
      // otherwise order arbitrarily, and the newest is the one being looked for.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        case: {
          select: {
            id: true, stage: true,
            lead: { select: { clientId: true, contact: { select: { fullName: true, email: true } } } },
          },
        },
      },
    });
  }

  /**
   * Record that the RECIPIENT of a handoff has opened the case.
   *
   * Fire-and-forget by design. It hangs off the case-detail read, which is the
   * most-hit staff page there is, so it must not slow that read down and must
   * not be able to fail it — hence no await on the caller's side and a catch
   * here.
   *
   * `firstViewedAt: null` in the WHERE is what makes it write-once: the second
   * view matches nothing. No read-then-write, so no race between two tabs.
   *
   * Matches nothing at all for the common case — someone opening a case that
   * was never handed to them — which costs one indexed lookup and no write.
   */
  async markFirstViewed(caseId: string, viewerId: string | null | undefined): Promise<void> {
    if (!viewerId) return;
    try {
      await this.prisma.caseHandoff.updateMany({
        where: { caseId, toUserId: viewerId, firstViewedAt: null },
        data: { firstViewedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.warn(`[handoff] firstViewedAt not recorded for case ${caseId}: ${e?.message ?? e}`);
    }
  }

  /**
   * The handoff log, for oversight.
   *
   * Every handoff, newest first, capped for the page. The full history stays in
   * the table regardless — this limit is what one screen shows, not what is
   * kept, and a reporting layer reads the table directly.
   */
  async listRecent(limit = RECENT_LIMIT) {
    return this.prisma.caseHandoff.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        case: {
          select: {
            id: true,
            lead: { select: { clientId: true, contact: { select: { fullName: true } } } },
          },
        },
      },
    });
  }
}
