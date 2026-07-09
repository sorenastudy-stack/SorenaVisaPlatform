import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// PR-CONSULT-1 — Case-assignment service.
//
// Three responsibilities:
//   1. Auto-allocate — pick the active staff user of the required
//      role with the fewest currently-active assignments.
//   2. Manual assign / reassign — close any active assignment for
//      (case, roleSlot), open a new one, audit-log the change.
//   3. Read helpers for the dashboard / staff workload views.
//
// All mutations write an audit_logs row with the appropriate
// eventType so the activity feed and consultant case file can show
// the history.

type RoleSlot = 'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE';

// Map from a VisaCaseRoleSlot to the UserRole(s) eligible to fill
// it. ADMIN tier can fill any slot if needed; staff users with the
// matching role are preferred.
const ELIGIBLE_USER_ROLES: Record<RoleSlot, string[]> = {
  LIA:        ['LIA'],
  CONSULTANT: ['CONSULTANT'],
  SUPPORT:    ['SUPPORT'],
  FINANCE:    ['FINANCE'],
};

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Pick the staff user with the fewest active assignments and
  // assign them to (caseId, roleSlot). Throws if no staff of that
  // role exists.
  async autoAllocate(
    caseId: string,
    roleSlot: RoleSlot,
    assignedById: string,
  ) {
    const candidates = await this.prisma.user.findMany({
      where: {
        role: { in: ELIGIBLE_USER_ROLES[roleSlot] as never },
        // Exclude users who have an explicit isActive=false row.
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: [
        // Tie-breaker: oldest createdAt first.
        { createdAt: 'asc' },
      ],
      include: {
        staffAssignments: {
          where:  { unassignedAt: null },
          select: { id: true },
        },
      },
    });

    if (candidates.length === 0) {
      throw new NotFoundException(
        `No active staff member with role ${roleSlot} is available for auto-allocation`,
      );
    }

    // Smallest open-assignment count wins.
    let pick = candidates[0]!;
    for (const c of candidates) {
      if (c.staffAssignments.length < pick.staffAssignments.length) {
        pick = c;
      }
    }

    return this.openAssignment(caseId, roleSlot, pick.id, assignedById, {
      auto: true,
    });
  }

  // Manual assign by an admin-tier user. Validates the new staff
  // member's role + active status before closing the existing
  // assignment and inserting a new row.
  async manualAssign(
    caseId: string,
    roleSlot: RoleSlot,
    staffId: string,
    assignedById: string,
  ) {
    const staff = await this.prisma.user.findUnique({
      where: { id: staffId },
      include: { staffActiveStatus: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff user not found');
    }
    if (!ELIGIBLE_USER_ROLES[roleSlot].includes(staff.role)) {
      throw new BadRequestException(
        `User ${staffId} has role ${staff.role}, which cannot fill slot ${roleSlot}`,
      );
    }
    if (staff.staffActiveStatus && staff.staffActiveStatus.isActive === false) {
      throw new BadRequestException('Cannot assign a deactivated staff user');
    }
    return this.openAssignment(caseId, roleSlot, staffId, assignedById, {
      auto: false,
    });
  }

  // Shared implementation for auto + manual. Wraps the
  // close-old + insert-new + audit in a single transaction so a
  // partial failure can't leave two active rows for the same
  // (case, roleSlot).
  private async openAssignment(
    caseId: string,
    roleSlot: RoleSlot,
    staffId: string,
    assignedById: string,
    opts: { auto: boolean },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Close any currently-active assignment for this slot.
      const existing = await tx.visaCaseAssignment.findFirst({
        where: { caseId, roleSlot: roleSlot as never, unassignedAt: null },
      });
      if (existing) {
        if (existing.staffId === staffId) {
          // Re-assigning to the same person → no-op.
          return existing;
        }
        await tx.visaCaseAssignment.update({
          where: { id: existing.id },
          data:  {
            unassignedAt:   new Date(),
            unassignedById: assignedById,
          },
        });
      }
      const created = await tx.visaCaseAssignment.create({
        data: {
          caseId,
          staffId,
          roleSlot: roleSlot as never,
          assignedById,
        },
      });
      // Audit. STAFF_REASSIGNED if we replaced a prior; otherwise
      // STAFF_ASSIGNED_AUTO / STAFF_ASSIGNED_MANUAL based on origin.
      const eventType = existing
        ? 'STAFF_REASSIGNED'
        : opts.auto
          ? 'STAFF_ASSIGNED_AUTO'
          : 'STAFF_ASSIGNED_MANUAL';
      await tx.auditLog.create({
        data: {
          userId:     assignedById,
          action:     eventType,
          eventType,
          entityType: 'VisaCaseAssignment',
          entityId:   created.id,
          oldValue:   existing
            ? { staffId: existing.staffId }
            : (null as never),
          newValue:   { caseId, roleSlot, staffId },
        },
      });
      return created;
    });
  }

  // Returns the currently-active assignment per slot, with the
  // staff user's name. Slots that aren't filled come back as null.
  async getCaseAssignments(caseId: string) {
    const rows = await this.prisma.visaCaseAssignment.findMany({
      where:   { caseId, unassignedAt: null },
      include: { staff: { select: { id: true, name: true, role: true } } },
    });
    const result: Record<RoleSlot, {
      id: string;
      staffId: string;
      staffName: string | null;
      staffRole: string;
      assignedAt: Date;
    } | null> = {
      LIA: null, CONSULTANT: null, SUPPORT: null, FINANCE: null,
    };
    for (const r of rows) {
      result[r.roleSlot as RoleSlot] = {
        id:         r.id,
        staffId:    r.staffId,
        staffName:  r.staff?.name ?? null,
        staffRole:  r.staff?.role ?? '',
        assignedAt: r.assignedAt,
      };
    }
    return result;
  }

  // For the staff workload view. Returns total + per-slot counts.
  //
  // Phase 2a: the CLIENT_CONSULTANT slot lives on Case.consultantId (a scalar
  // FK added in Phase 1), NOT in the VisaCaseAssignment table (whose roleSlot
  // enum has no CLIENT_CONSULTANT value). So its count is sourced directly from
  // open cases where this user is the consultant, mirroring the "open case" =
  // stage NOT IN (COMPLETED, WITHDRAWN) definition used by the auto-assigner.
  async getStaffWorkload(staffId: string) {
    const rows = await this.prisma.visaCaseAssignment.findMany({
      where:  { staffId, unassignedAt: null },
      select: { roleSlot: true },
    });
    const consultantOpenCases = await this.prisma.case.count({
      where: {
        consultantId: staffId,
        stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
      },
    });
    const byRoleSlot: Record<RoleSlot | 'CLIENT_CONSULTANT', number> = {
      LIA: 0, CONSULTANT: 0, SUPPORT: 0, FINANCE: 0,
      CLIENT_CONSULTANT: consultantOpenCases,
    };
    for (const r of rows) byRoleSlot[r.roleSlot as RoleSlot]++;
    return {
      activeCount: rows.length + consultantOpenCases,
      byRoleSlot,
    };
  }

  // For the "reassign" UI dropdown — list every active staff user
  // of the matching role with their current open-assignment count.
  async listAvailableStaffForRole(roleSlot: RoleSlot) {
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: ELIGIBLE_USER_ROLES[roleSlot] as never },
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      include: {
        staffAssignments: {
          where:  { unassignedAt: null },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      staffId:               u.id,
      name:                  u.name,
      activeAssignmentCount: u.staffAssignments.length,
    }));
  }

  // Close every currently-active assignment for a given staff user
  // (used when DEACTIVATE_STAFF runs). Returns the list of
  // (caseId, roleSlot) pairs that now need re-allocation so the
  // caller can fire autoAllocate for each.
  async closeAllAssignmentsForStaff(
    staffId: string,
    closedById: string,
  ): Promise<Array<{ caseId: string; roleSlot: RoleSlot }>> {
    const open = await this.prisma.visaCaseAssignment.findMany({
      where:  { staffId, unassignedAt: null },
      select: { id: true, caseId: true, roleSlot: true },
    });
    if (open.length === 0) return [];
    await this.prisma.$transaction([
      this.prisma.visaCaseAssignment.updateMany({
        where: { id: { in: open.map((r) => r.id) } },
        data:  { unassignedAt: new Date(), unassignedById: closedById },
      }),
    ]);
    return open.map((r) => ({
      caseId: r.caseId, roleSlot: r.roleSlot as RoleSlot,
    }));
  }
}
