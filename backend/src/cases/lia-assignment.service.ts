import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// PR-LIA-2 — LIA auto-assignment + manual reassignment.
//
// Mirrors PR-CONSULT-1's load-based auto-allocation
// (backend/src/staff/assignments/assignments.service.ts):
//
//   * Candidate pool: users where role='LIA' AND isActive=true AND
//     (staffActiveStatus IS NULL OR staffActiveStatus.isActive=true)
//   * Workload count: open cases on this LIA (stage NOT IN
//     COMPLETED/WITHDRAWN). PR-CONSULT-1 counted VisaCaseAssignment
//     rows; PR-LIA-2 counts CRM Case.liaId directly. Different target
//     model, same intent.
//   * Pick: lowest count wins. Tie-break by createdAt ASC (oldest
//     hire first), matching PR-CONSULT-1.
//
// PR-LIA-2 explicitly does NOT consider `User.specialisedCountries`
// — that column is forward-compat for PR-LIA-2.1's country router.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface RosterRow {
  id: string;
  name: string;
  email: string;
  openCases: number;
}

interface ManualReassignDto {
  liaId: string | null;
  reason: string;
}

interface ManualReassignOwnerDto {
  ownerId: string | null;
  reason: string;
}

interface ManualReassignSupportDto {
  supportId: string | null;
  reason: string;
}

interface ManualReassignFinanceDto {
  financeId: string | null;
  reason: string;
}

interface AssignResult {
  status: 'assigned' | 'no_candidates' | 'already_assigned';
  liaId: string | null;
  liaName: string | null;
}

@Injectable()
export class LiaAssignmentService {
  private readonly logger = new Logger(LiaAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Roster ────────────────────────────────────────────────────────────

  async getRoster(): Promise<RosterRow[]> {
    const candidates = await this.findActiveLias();
    const rows: RosterRow[] = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      openCases: c.liaCases.length,
    }));
    // Sort: lowest openCases first, then oldest createdAt (already
    // returned in that order by the DB) as a stable tie-breaker.
    rows.sort((a, b) => a.openCases - b.openCases);
    return rows;
  }

  // ─── Auto-assign on contract sign ──────────────────────────────────────

  async assignLiaToCase(caseId: string, triggerActor?: Actor): Promise<AssignResult> {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, liaId: true, lead: { select: { contact: { select: { fullName: true } } } } },
    });
    if (!existing) {
      this.logger.warn(`assignLiaToCase: case ${caseId} not found`);
      return { status: 'no_candidates', liaId: null, liaName: null };
    }
    if (existing.liaId) {
      // Idempotency: don't replace an existing assignment. Manual
      // reassignment lives on a different endpoint.
      return { status: 'already_assigned', liaId: existing.liaId, liaName: null };
    }

    const candidates = await this.findActiveLias();
    if (candidates.length === 0) {
      this.logger.warn(
        `assignLiaToCase: no active LIAs available for case ${caseId} — leaving unassigned`,
      );
      await this.prisma.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'LIA_AUTO_ASSIGN_NO_CANDIDATES',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { reason: 'no_active_lias' } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return { status: 'no_candidates', liaId: null, liaName: null };
    }

    // Lowest open-case count wins; ties broken by createdAt ASC (the
    // DB sort order, preserved by the linear scan below).
    let pick = candidates[0]!;
    for (const c of candidates) {
      if (c.liaCases.length < pick.liaCases.length) pick = c;
    }

    const candidatesAudit = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      openCases: c.liaCases.length,
    }));

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        // PR-LIA-3: stamp the assignment time inside the same tx so
        // the productivity report's time-to-action / time-to-resolution
        // calculations have a reference point.
        data: { liaId: pick.id, liaAssignedAt: new Date() },
        select: { id: true, leadId: true },
      });
      await tx.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'LIA_AUTO_ASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            liaId: pick.id,
            liaName: pick.name,
            candidates: candidatesAudit,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System (contract signed)',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return u;
    });

    // Best-effort email — fire-and-forget; never blocks the caller.
    this.notifications
      .sendNewLiaAssignment(
        pick.email,
        pick.name,
        updated.id,
        existing.lead?.contact?.fullName ?? 'A client',
      )
      .catch((err) => this.logger.error(`Failed to email new LIA: ${err?.message ?? err}`));

    return { status: 'assigned', liaId: pick.id, liaName: pick.name };
  }

  // ─── Manual reassignment (OWNER / ADMIN / SUPER_ADMIN) ────────────────

  async manualReassign(
    caseId: string,
    dto: ManualReassignDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        liaId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        lia: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newLia: { id: string; name: string; email: string } | null = null;
    if (dto.liaId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.liaId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target LIA not found');
      if (target.role !== 'LIA') {
        throw new BadRequestException('Target user is not an LIA');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target LIA is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target LIA is archived');
      }
      newLia = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        // PR-LIA-3: stamp the assignment time on a reassignment; clear
        // it when the LIA is unassigned (liaId: null). The productivity
        // metrics treat liaAssignedAt as the start-of-clock per case.
        data: {
          liaId: newLia?.id ?? null,
          liaAssignedAt: newLia?.id ? new Date() : null,
        },
        include: {
          lia: { select: { id: true, name: true, email: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'LIA_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            liaId: existing.liaId ?? null,
            liaName: existing.lia?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            liaId: newLia?.id ?? null,
            liaName: newLia?.name ?? null,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    const clientName = existing.lead?.contact?.fullName ?? 'A client';

    if (newLia) {
      this.notifications
        .sendNewLiaAssignment(newLia.email, newLia.name, caseId, clientName)
        .catch((err) =>
          this.logger.error(`Failed to email new LIA on reassignment: ${err?.message ?? err}`),
        );
    }
    if (existing.lia && existing.lia.id !== newLia?.id) {
      this.notifications
        .sendLiaAssignmentReleased(
          existing.lia.email,
          existing.lia.name,
          caseId,
          clientName,
        )
        .catch((err) =>
          this.logger.error(`Failed to email released LIA: ${err?.message ?? err}`),
        );
    }

    return updated;
  }

  // ─── Owner (Admission Specialist) manual reassignment ─────────────────
  //
  // Option 1 step 3a — mirror of manualReassign() for the CONSULTANT
  // slot, which lives on Case.ownerId. No timestamp column (Case has
  // no ownerAssignedAt) and no emails in v1 (the LIA email helpers
  // hardcode "LIA" copy + an LIA-portal link; reusing them would be
  // wrong, mirroring the templates is out of scope for this step).
  async reassignOwner(
    caseId: string,
    dto: ManualReassignOwnerDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        ownerId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newOwner: { id: string; name: string; email: string } | null = null;
    if (dto.ownerId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.ownerId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'CONSULTANT') {
        throw new BadRequestException('Target user is not an Admission Specialist');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Admission Specialist is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Admission Specialist is archived');
      }
      newOwner = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data: {
          ownerId: newOwner?.id ?? null,
        },
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'OWNER_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            ownerId: existing.ownerId ?? null,
            ownerName: existing.owner?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            ownerId: newOwner?.id ?? null,
            ownerName: newOwner?.name ?? null,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Support manual reassignment ──────────────────────────────────────
  //
  // Option 1 step 4b — mirror of reassignOwner() for the SUPPORT slot,
  // which lives on Case.supportId (added in 4a migration). Same shape
  // as reassignOwner: no timestamp column, no emails in v1.
  async reassignSupport(
    caseId: string,
    dto: ManualReassignSupportDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        supportId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        support: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newSupport: { id: string; name: string; email: string } | null = null;
    if (dto.supportId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.supportId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'SUPPORT') {
        throw new BadRequestException('Target user is not a Support staff member');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Support staff member is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Support staff member is archived');
      }
      newSupport = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data:  { supportId: newSupport?.id ?? null },
        include: { support: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'SUPPORT_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            supportId: existing.supportId ?? null,
            supportName: existing.support?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            supportId: newSupport?.id ?? null,
            supportName: newSupport?.name ?? null,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Finance manual reassignment ──────────────────────────────────────
  //
  // Option 1 step 4b — mirror of reassignOwner() for the FINANCE slot,
  // which lives on Case.financeId (added in 4a migration). Same shape.
  async reassignFinance(
    caseId: string,
    dto: ManualReassignFinanceDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        financeId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        finance: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newFinance: { id: string; name: string; email: string } | null = null;
    if (dto.financeId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.financeId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'FINANCE') {
        throw new BadRequestException('Target user is not a Finance staff member');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Finance staff member is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Finance staff member is archived');
      }
      newFinance = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data:  { financeId: newFinance?.id ?? null },
        include: { finance: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'FINANCE_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            financeId: existing.financeId ?? null,
            financeName: existing.finance?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            financeId: newFinance?.id ?? null,
            financeName: newFinance?.name ?? null,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  // PR-CONSULT-1 mirror: pick candidates by role, exclude archived
  // (StaffActiveStatus.isActive=false), and pre-load each candidate's
  // open-cases collection for the counting step. Order by createdAt
  // ASC so the linear scan's lowest-count winner ties to the oldest
  // hire.
  private async findActiveLias() {
    return this.prisma.user.findMany({
      where: {
        role: 'LIA',
        isActive: true,
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        liaCases: {
          where: {
            stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
          },
          select: { id: true },
        },
      },
    });
  }
}
