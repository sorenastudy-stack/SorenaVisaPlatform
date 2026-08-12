import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionTriggerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';
import { CommissionsService } from './commissions.service';

// PR-COMMISSION-TRIGGER — the claim an Admission Officer makes, and the decision
// Finance makes on it.
//
// The Operations Manual describes this as "submit commission trigger, Finance
// approves". Until now neither half existed: a commission appeared because
// somebody opened a modal and typed one in. Approval is what creates the
// commission row now, so every commission carries the fact that one person
// claimed it and a different person agreed.

/** How long after the student's first class the claim becomes submittable. */
export const ELIGIBILITY_DAYS = 14;

/** Roles that may confirm attendance and submit a claim, on their own cases. */
export const TRIGGER_SUBMIT_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT'];

/** Roles that decide. Same set that runs the commission ledger. */
export const TRIGGER_DECIDE_ROLES = ['OWNER', 'SUPER_ADMIN', 'FINANCE'];

export interface TriggerActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
}

@Injectable()
export class CommissionTriggersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: CommissionsService,
  ) {}

  /** The moment a first class must precede for its claim to be submittable. */
  private eligibilityCutoff(now = new Date()): Date {
    return new Date(now.getTime() - ELIGIBILITY_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * The case-ownership filter, as a Prisma fragment.
   *
   * Same chain the commission ledger walks — Commission and CommissionTrigger
   * both hang off the programme choice, so "my cases" means the same thing on
   * both sides and cannot drift.
   */
  private ownScope(actor: TriggerActor) {
    if (hasRole(actor, 'OWNER', 'SUPER_ADMIN', 'ADMIN')) return {};
    if (!actor.id) {
      throw new ForbiddenException('You are not allowed to view commission triggers.');
    }
    return { admissionApplication: { case: { lead: { ownerId: actor.id } } } };
  }

  /**
   * Record that the student turned up.
   *
   * Idempotent in the sense that matters: re-confirming does NOT move the date.
   * The clock to eligibility starts at the first class, and letting a second
   * click restart it would quietly delay the claim by another fortnight.
   */
  async confirmFirstClassAttended(
    caseId: string,
    programmeChoiceId: string,
    attendedAt: Date | null,
    actor: TriggerActor,
  ) {
    const choice = await this.prisma.admissionProgrammeChoice.findFirst({
      where: { id: programmeChoiceId, admissionApplication: { caseId } },
      select: { id: true, firstClassAttendedAt: true },
    });
    // Not-found rather than forbidden: a choice on someone else's case is not
    // something the caller should learn exists.
    if (!choice) throw new NotFoundException('Programme choice not found on this case');

    if (choice.firstClassAttendedAt) {
      throw new BadRequestException(
        'First class attendance is already recorded for this programme.',
      );
    }

    const when = attendedAt ?? new Date();
    if (when.getTime() > Date.now()) {
      throw new BadRequestException('First class attendance cannot be in the future.');
    }

    return this.prisma.admissionProgrammeChoice.update({
      where: { id: choice.id },
      data: { firstClassAttendedAt: when },
      select: { id: true, firstClassAttendedAt: true },
    });
  }

  /**
   * Programme choices whose claim can be submitted now.
   *
   * Eligibility is computed here, on read: attendance confirmed, and at least
   * ELIGIBILITY_DAYS ago. No stored flag and no scheduled job — a boolean
   * written by a nightly sweep is wrong between the moment it becomes true and
   * the moment the sweep runs, and needs backfilling whenever the sweep misses.
   *
   * Choices with a live claim are excluded, so submitting makes a row leave the
   * queue. A REJECTED claim does NOT exclude it: a refusal that can never be
   * revisited would strand the commission permanently.
   */
  async listEligible(actor: TriggerActor) {
    if (!hasRole(actor, ...TRIGGER_SUBMIT_ROLES)) {
      throw new ForbiddenException('You are not allowed to submit commission triggers.');
    }

    const choices = await this.prisma.admissionProgrammeChoice.findMany({
      where: {
        firstClassAttendedAt: { not: null, lte: this.eligibilityCutoff() },
        commission: null,
        commissionTriggers: {
          none: { status: { in: [CommissionTriggerStatus.PENDING, CommissionTriggerStatus.APPROVED] } },
        },
        ...this.ownScope(actor),
      },
      orderBy: { firstClassAttendedAt: 'asc' },
      include: {
        programme: { select: { id: true, name: true, provider: { select: { id: true, name: true } } } },
        admissionApplication: {
          select: {
            caseId: true,
            case: { select: { lead: { select: { clientId: true, contact: { select: { fullName: true } } } } } },
          },
        },
        commissionTriggers: {
          where: { status: CommissionTriggerStatus.REJECTED },
          orderBy: { decidedAt: 'desc' },
          take: 1,
          select: { rejectionReason: true, decidedAt: true },
        },
      },
    });

    return choices.map((c) => ({
      programmeChoiceId: c.id,
      caseId: c.admissionApplication?.caseId ?? null,
      clientId: c.admissionApplication?.case?.lead?.clientId ?? null,
      studentName: c.admissionApplication?.case?.lead?.contact?.fullName ?? null,
      programmeId: c.programme?.id ?? null,
      programmeName: c.programme?.name ?? null,
      providerId: c.programme?.provider?.id ?? null,
      providerName: c.programme?.provider?.name ?? null,
      firstClassAttendedAt: c.firstClassAttendedAt,
      eligibleSince: c.firstClassAttendedAt
        ? new Date(c.firstClassAttendedAt.getTime() + ELIGIBILITY_DAYS * 86_400_000)
        : null,
      // Present only when a previous claim was refused — the reader needs to
      // know why before re-submitting the same thing.
      previouslyRejected: c.commissionTriggers[0]
        ? {
            reason: c.commissionTriggers[0].rejectionReason,
            decidedAt: c.commissionTriggers[0].decidedAt,
          }
        : null,
    }));
  }

  /**
   * Programme choices on the caller's cases with no attendance recorded yet.
   *
   * The step before eligibility: nothing can be claimed until someone confirms
   * the student actually turned up, and there was previously nowhere to say so.
   * Same scope as the eligible queue, so an officer sees one page covering both
   * halves of their part in this.
   */
  async listAwaitingAttendance(actor: TriggerActor) {
    if (!hasRole(actor, ...TRIGGER_SUBMIT_ROLES)) {
      throw new ForbiddenException('You are not allowed to record class attendance.');
    }

    const choices = await this.prisma.admissionProgrammeChoice.findMany({
      where: { firstClassAttendedAt: null, commission: null, ...this.ownScope(actor) },
      orderBy: [{ intakeYear: 'asc' }, { intakeMonth: 'asc' }, { priority: 'asc' }],
      include: {
        programme: { select: { id: true, name: true, provider: { select: { id: true, name: true } } } },
        admissionApplication: {
          select: {
            caseId: true,
            case: { select: { lead: { select: { clientId: true, contact: { select: { fullName: true } } } } } },
          },
        },
      },
    });

    return choices.map((c) => ({
      programmeChoiceId: c.id,
      caseId: c.admissionApplication?.caseId ?? null,
      clientId: c.admissionApplication?.case?.lead?.clientId ?? null,
      studentName: c.admissionApplication?.case?.lead?.contact?.fullName ?? null,
      programmeName: c.programme?.name ?? null,
      providerName: c.programme?.provider?.name ?? null,
      intakeMonth: c.intakeMonth,
      intakeYear: c.intakeYear,
    }));
  }

  /** Submit the claim. */
  async submit(programmeChoiceId: string, actor: TriggerActor) {
    if (!hasRole(actor, ...TRIGGER_SUBMIT_ROLES)) {
      throw new ForbiddenException('You are not allowed to submit commission triggers.');
    }
    if (!actor.id) throw new ForbiddenException('You are not allowed to submit commission triggers.');

    const choice = await this.prisma.admissionProgrammeChoice.findFirst({
      where: { id: programmeChoiceId, ...this.ownScope(actor) },
      select: { id: true, firstClassAttendedAt: true, commission: { select: { id: true } } },
    });
    if (!choice) throw new NotFoundException('Programme choice not found');

    if (choice.commission) {
      throw new BadRequestException('A commission already exists for this programme.');
    }
    if (!choice.firstClassAttendedAt) {
      throw new BadRequestException('Confirm the student attended their first class first.');
    }
    if (choice.firstClassAttendedAt > this.eligibilityCutoff()) {
      const ready = new Date(choice.firstClassAttendedAt.getTime() + ELIGIBILITY_DAYS * 86_400_000);
      throw new BadRequestException(
        `Not yet — a claim can be submitted ${ELIGIBILITY_DAYS} days after the first class, from ${ready.toISOString().slice(0, 10)}.`,
      );
    }

    try {
      return await this.prisma.commissionTrigger.create({
        data: { programmeChoiceId, submittedById: actor.id },
      });
    } catch (e) {
      // The partial unique index — one live claim per choice. Two officers
      // clicking at once is the realistic case, and it deserves a sentence
      // rather than a constraint name.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('A commission trigger has already been submitted for this programme.');
      }
      throw e;
    }
  }

  /** The approval queue. */
  async listPending(actor: TriggerActor) {
    if (!hasRole(actor, ...TRIGGER_DECIDE_ROLES)) {
      throw new ForbiddenException('You are not allowed to review commission triggers.');
    }

    const rows = await this.prisma.commissionTrigger.findMany({
      where: { status: CommissionTriggerStatus.PENDING },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      include: {
        programmeChoice: {
          include: {
            programme: { select: { id: true, name: true, provider: { select: { id: true, name: true } } } },
            admissionApplication: {
              select: {
                caseId: true,
                case: { select: { lead: { select: { clientId: true, contact: { select: { fullName: true } } } } } },
              },
            },
          },
        },
      },
    });

    // Submitter names resolved in one query — the actor fields are plain id
    // snapshots (the convention in this cluster), so there is no relation to
    // include and N round-trips is not the alternative worth taking.
    const ids = [...new Set(rows.map((r) => r.submittedById))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return rows.map((t) => ({
      id: t.id,
      programmeChoiceId: t.programmeChoiceId,
      submittedAt: t.submittedAt,
      submittedById: t.submittedById,
      submittedByName: nameById.get(t.submittedById) ?? null,
      caseId: t.programmeChoice?.admissionApplication?.caseId ?? null,
      clientId: t.programmeChoice?.admissionApplication?.case?.lead?.clientId ?? null,
      studentName: t.programmeChoice?.admissionApplication?.case?.lead?.contact?.fullName ?? null,
      programmeId: t.programmeChoice?.programme?.id ?? null,
      programmeName: t.programmeChoice?.programme?.name ?? null,
      providerId: t.programmeChoice?.programme?.provider?.id ?? null,
      providerName: t.programmeChoice?.programme?.provider?.name ?? null,
      firstClassAttendedAt: t.programmeChoice?.firstClassAttendedAt ?? null,
    }));
  }

  /**
   * Approve, and create the commission.
   *
   * The commission is created through CommissionsService.createCommission — the
   * same method the ledger's Record button calls — so the provider/programme
   * checks built in Part 1 apply to a commission born this way too, rather than
   * a second creation path growing its own rules.
   */
  async approve(
    id: string,
    body: { commissionType?: 'PERCENTAGE' | 'FIXED'; commissionValue: number; commissionYear?: number; estimatedAmountNZD?: number },
    actor: TriggerActor,
  ) {
    if (!hasRole(actor, ...TRIGGER_DECIDE_ROLES)) {
      throw new ForbiddenException('You are not allowed to decide commission triggers.');
    }

    const trigger = await this.prisma.commissionTrigger.findUnique({
      where: { id },
      include: { programmeChoice: { include: { programme: { select: { id: true, providerId: true } } } } },
    });
    if (!trigger) throw new NotFoundException('Commission trigger not found');
    if (trigger.status !== CommissionTriggerStatus.PENDING) {
      throw new BadRequestException(`This trigger is already ${trigger.status.toLowerCase()}.`);
    }
    const programme = trigger.programmeChoice?.programme;
    if (!programme) throw new BadRequestException('That programme is no longer on record.');

    const commission = await this.commissions.createCommission({
      programmeChoiceId: trigger.programmeChoiceId,
      providerId: programme.providerId,
      programmeId: programme.id,
      commissionType: (body.commissionType ?? 'PERCENTAGE') as any,
      commissionValue: body.commissionValue,
      commissionYear: body.commissionYear ?? 1,
      ...(body.estimatedAmountNZD !== undefined ? { estimatedAmountNZD: body.estimatedAmountNZD } : {}),
    } as any);

    // Marked approved only after the commission exists: an approved trigger
    // with no commission is a claim everyone believes was actioned.
    const updated = await this.prisma.commissionTrigger.update({
      where: { id },
      data: {
        status: CommissionTriggerStatus.APPROVED,
        decidedById: actor.id ?? null,
        decidedAt: new Date(),
      },
    });

    return { trigger: updated, commission };
  }

  /** Reject, with a reason the submitter can act on. */
  async reject(id: string, reason: string, actor: TriggerActor) {
    if (!hasRole(actor, ...TRIGGER_DECIDE_ROLES)) {
      throw new ForbiddenException('You are not allowed to decide commission triggers.');
    }
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('A reason is required when rejecting a commission trigger.');

    const trigger = await this.prisma.commissionTrigger.findUnique({ where: { id }, select: { status: true } });
    if (!trigger) throw new NotFoundException('Commission trigger not found');
    if (trigger.status !== CommissionTriggerStatus.PENDING) {
      throw new BadRequestException(`This trigger is already ${trigger.status.toLowerCase()}.`);
    }

    return this.prisma.commissionTrigger.update({
      where: { id },
      data: {
        status: CommissionTriggerStatus.REJECTED,
        decidedById: actor.id ?? null,
        decidedAt: new Date(),
        rejectionReason: trimmed,
      },
    });
  }
}
