import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnerApprovalService } from '../owner-approval/owner-approval.service';

// PR-CONSULT-1 — Staff-user CRUD service.
//
// The "execute or enqueue" helper at the bottom is the heart of
// this module: SUPER_ADMIN's destructive actions get queued for
// OWNER approval; OWNER executes inline; ADMIN gets 403.
//
// Non-destructive actions (list / detail / reactivate) execute
// inline for OWNER + SUPER_ADMIN both.

type CallerRole = string;

@Injectable()
export class StaffUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approval: OwnerApprovalService,
  ) {}

  // ── Reads (admin tier — controller enforces) ──────────────────────

  async list() {
    // Prisma rejects mixing `select` + `include` on the same query.
    // We use `include` to pull the active-status relation and then
    // whitelist the parent fields in the map below.
    const users = await this.prisma.user.findMany({
      where:   { role: { not: 'STUDENT' as never } },
      orderBy: { createdAt: 'asc' },
      include: {
        staffActiveStatus: { select: { isActive: true, deactivatedAt: true } },
      },
    });
    return users.map((u) => ({
      id:        u.id,
      email:     u.email,
      name:      u.name,
      role:      u.role,
      createdAt: u.createdAt,
      isActive:  u.staffActiveStatus?.isActive !== false, // default true
    }));
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { staffActiveStatus: true },
    });
    if (!user) throw new ForbiddenException(); // mask existence
    if (user.role === 'STUDENT') throw new ForbiddenException();
    return {
      id:        user.id,
      email:     user.email,
      name:      user.name,
      role:      user.role,
      createdAt: user.createdAt,
      isActive:  user.staffActiveStatus?.isActive !== false,
    };
  }

  // ── Reactivate (non-destructive — OWNER + SUPER_ADMIN inline) ────

  async reactivate(userId: string, actorId: string) {
    await this.approval.reactivateStaffDirect(userId, actorId);
    return { ok: true };
  }

  // ── Owner-or-enqueue dispatcher ──────────────────────────────────

  // Returns either the executed result (OWNER) or the enqueued
  // approval row id (SUPER_ADMIN). Controllers call this for every
  // destructive action and forward the response.
  async ownerOrEnqueue(args: {
    callerRole: CallerRole;
    callerId:   string;
    actionType:
      | 'CREATE_STAFF_USER'
      | 'CHANGE_STAFF_ROLE'
      | 'DEACTIVATE_STAFF';
    payload:    Record<string, unknown>;
    reason?:    string;
  }) {
    if (args.callerRole === 'OWNER') {
      // Execute directly via the approval service's executor
      // dispatch — keeps the action logic in one place.
      await this.approval.executeApprovedAction(
        args.actionType,
        args.payload,
        args.callerId,
      );
      return { status: 'EXECUTED' as const };
    }
    if (args.callerRole === 'SUPER_ADMIN') {
      const created = await this.approval.requestApproval({
        requestedById: args.callerId,
        actionType:    args.actionType,
        payload:       args.payload,
        reason:        args.reason,
      });
      return {
        status:    'PENDING_OWNER_APPROVAL' as const,
        requestId: created.id,
      };
    }
    // ADMIN and below cannot perform these actions at all.
    throw new ForbiddenException(
      'Only OWNER and SUPER_ADMIN can perform this action',
    );
  }

  // Helper used by the create-staff endpoint when the caller is
  // OWNER — returns the freshly-created user + temp password so
  // the controller can include it in the response (the OWNER
  // shares it out-of-band).
  async createStaffUserAsOwner(args: {
    email: string;
    fullName: string;
    role: string;
    actorId: string;
  }) {
    return this.approval.createStaffUserDirect({
      email: args.email,
      name:  args.fullName,
      role:  args.role,
      actorId: args.actorId,
    });
  }
}
