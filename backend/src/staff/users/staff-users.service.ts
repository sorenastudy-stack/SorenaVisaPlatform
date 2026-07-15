import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { OwnerApprovalService } from '../owner-approval/owner-approval.service';

// PR-CONSULT-1 — Staff-user CRUD service.
// PR-CONSULT-4 — extended with staff-profile fields, an Update
// profile method, list-archived filtering, and the hard-delete
// flow that snapshots audit rows + cleans up FK chains before
// removing the User row.
//
// Encryption envelope: same base64-AES-256-GCM as every other
// staff-tier PR. `mobileNumber`, `address`, `emergencyContact`
// are encrypted at rest. `countryOfResidence` stays plain (ISO
// 3166-1 alpha-2 — needed for filter/aggregate).

type CallerRole = string;

@Injectable()
export class StaffUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly approval: OwnerApprovalService,
  ) {}

  // ── Crypto helpers (base64 envelope) ──────────────────────────────

  private enc(plain: string): string {
    return this.crypto.encrypt(plain).toString('base64');
  }
  private encOrNull(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    return this.enc(plain);
  }
  private dec(stored: string | null | undefined): string | null {
    if (!stored) return null;
    try {
      return this.crypto.decrypt(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────

  // PR-CONSULT-4: `archived` filter. `false` (default) → only active
  // staff; `true` → only archived; `all` → both. We resolve `isActive`
  // from StaffActiveStatus (missing row = active, matching the
  // existing guard semantics).
  async list(opts: { archived?: 'false' | 'true' | 'all' } = {}) {
    const archived = opts.archived ?? 'false';
    const users = await this.prisma.user.findMany({
      where:   { role: { not: 'STUDENT' as never } },
      orderBy: { createdAt: 'asc' },
      include: {
        staffActiveStatus: { select: { isActive: true, deactivatedAt: true } },
      },
    });
    const filtered = users.filter((u) => {
      const isActive = u.staffActiveStatus?.isActive !== false;
      if (archived === 'false') return isActive;
      if (archived === 'true')  return !isActive;
      return true;
    });
    return filtered.map((u) => ({
      id:        u.id,
      email:     u.email,
      name:      u.name,
      role:      u.role,
      createdAt: u.createdAt,
      isActive:  u.staffActiveStatus?.isActive !== false,
    }));
  }

  // PR-CONSULT-4: detail includes decrypted profile fields + archive
  // metadata so the frontend can render "Archived on {date} by
  // {actor}" without a second round-trip.
  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { staffActiveStatus: true },
    });
    if (!user) throw new ForbiddenException(); // mask existence
    if (user.role === 'STUDENT') throw new ForbiddenException();

    let deactivatedByName: string | null = null;
    if (user.staffActiveStatus?.deactivatedById) {
      const actor = await this.prisma.user.findUnique({
        where:  { id: user.staffActiveStatus.deactivatedById },
        select: { name: true },
      });
      deactivatedByName = actor?.name ?? null;
    }

    return {
      id:                 user.id,
      email:              user.email,
      name:               user.name,
      role:               user.role,
      secondaryRoles:     user.secondaryRoles,
      createdAt:          user.createdAt,
      isActive:           user.staffActiveStatus?.isActive !== false,
      mobileNumber:       this.dec(user.mobileNumber),
      countryOfResidence: user.countryOfResidence,
      address:            this.dec(user.address),
      emergencyContact:   this.dec(user.emergencyContact),
      archivedAt:         user.staffActiveStatus?.deactivatedAt ?? null,
      archivedById:       user.staffActiveStatus?.deactivatedById ?? null,
      archivedByName:     deactivatedByName,
    };
  }

  // ── PR-CONSULT-4: edit profile ────────────────────────────────────
  //
  // Both OWNER and SUPER_ADMIN execute inline — edits are
  // non-destructive (no cascade, no relocation). ADMIN forbidden at
  // the controller. Email uniqueness re-checked at the DB layer;
  // P2002 surfaces as 409.
  async updateProfile(args: {
    targetId: string;
    actorId: string;
    patch: {
      name?: string;
      email?: string;
      mobileNumber?: string;
      countryOfResidence?: string;
      address?: string;
      emergencyContact?: string;
    };
  }) {
    const target = await this.prisma.user.findUnique({
      where: { id: args.targetId },
    });
    if (!target) throw new NotFoundException('Staff user not found');
    if (target.role === 'STUDENT') {
      throw new ForbiddenException('Not a staff user');
    }

    // Build the prisma data object + audit "changedFields" list in
    // one pass. Three encrypted fields go through `encOrNull`; the
    // other three are stored plain. `email` is lowercased + trimmed
    // for stable uniqueness.
    const data: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (args.patch.name !== undefined && args.patch.name.trim() !== target.name) {
      data.name = args.patch.name.trim();
      changedFields.push('name');
    }
    if (args.patch.email !== undefined) {
      const normalised = args.patch.email.toLowerCase().trim();
      if (normalised !== target.email) {
        data.email = normalised;
        changedFields.push('email');
      }
    }
    if (args.patch.mobileNumber !== undefined) {
      data.mobileNumber = this.encOrNull(args.patch.mobileNumber.trim());
      changedFields.push('mobileNumber');
    }
    if (args.patch.countryOfResidence !== undefined) {
      data.countryOfResidence = args.patch.countryOfResidence;
      changedFields.push('countryOfResidence');
    }
    if (args.patch.address !== undefined) {
      data.address = this.encOrNull(args.patch.address);
      changedFields.push('address');
    }
    if (args.patch.emergencyContact !== undefined) {
      data.emergencyContact = this.encOrNull(args.patch.emergencyContact);
      changedFields.push('emergencyContact');
    }

    if (changedFields.length === 0) {
      return { ok: true, changedFields: [] };
    }

    try {
      await this.prisma.user.update({
        where: { id: args.targetId },
        data,
      });
    } catch (err: unknown) {
      // Prisma's known unique-constraint violation surface — convert
      // to a 409 with a clear message rather than the generic 500
      // the global filter would emit.
      if (typeof err === 'object' && err !== null
          && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }

    // Audit. We log the list of fields changed but NOT the new
    // values — sensitive profile data shouldn't leak into the audit
    // table when the columns themselves are already encrypted.
    const actor = await this.prisma.user.findUnique({
      where: { id: args.actorId }, select: { name: true, role: true },
    });
    await this.prisma.auditLog.create({
      data: {
        userId:            args.actorId,
        action:            'STAFF_PROFILE_UPDATED',
        eventType:         'STAFF_PROFILE_UPDATED',
        entityType:        'User',
        entityId:          args.targetId,
        newValue:          { changedFields },
        actorNameSnapshot: actor?.name ?? null,
        actorRoleSnapshot: actor?.role ?? null,
      },
    });

    return { ok: true, changedFields };
  }

  // ── Reactivate (non-destructive — OWNER + SUPER_ADMIN inline) ────

  // ── Secondary roles (OWNER only) ──────────────────────────────────
  //
  // Secondary roles WIDEN access only — they never touch `role` (login,
  // routing, badge are unchanged). OWNER-only is enforced by @StaffRoles('OWNER')
  // on the controller, which checks the PRIMARY role — a secondary OWNER can't
  // reach this grant surface. A user can NEVER change their own secondary roles
  // (no self-escalation), submitted values are whitelisted to the UserRole
  // enum, the target's primary role is stripped (a role is primary xor
  // secondary), and every change is audited (who, target, before, after, when).
  async setSecondaryRoles(args: {
    targetId: string;
    actorId: string;
    secondaryRoles: string[];
  }): Promise<{ userId: string; secondaryRoles: UserRole[] }> {
    if (args.targetId === args.actorId) {
      throw new ForbiddenException('You cannot change your own secondary roles');
    }

    const target = await this.prisma.user.findUnique({
      where:  { id: args.targetId },
      select: { id: true, role: true, secondaryRoles: true },
    });
    if (!target || target.role === 'STUDENT') throw new ForbiddenException(); // mask existence

    // Whitelist to valid UserRole values, dedupe, and drop the primary role.
    const valid = new Set<string>(Object.values(UserRole));
    const cleaned = Array.from(new Set(args.secondaryRoles)).filter(
      (r) => valid.has(r) && r !== target.role,
    ) as UserRole[];

    const before = target.secondaryRoles;
    const updated = await this.prisma.user.update({
      where:  { id: target.id },
      data:   { secondaryRoles: { set: cleaned } },
      select: { id: true, secondaryRoles: true },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: args.actorId }, select: { name: true, role: true },
    });
    await this.prisma.auditLog.create({
      data: {
        userId:            args.actorId,
        action:            'CHANGE_STAFF_SECONDARY_ROLES',
        eventType:         'CHANGE_STAFF_SECONDARY_ROLES',
        entityType:        'User',
        entityId:          target.id,
        oldValue:          { secondaryRoles: before },
        newValue:          { secondaryRoles: updated.secondaryRoles },
        actorNameSnapshot: actor?.name ?? null,
        actorRoleSnapshot: actor?.role ?? null,
      },
    });

    return { userId: updated.id, secondaryRoles: updated.secondaryRoles };
  }

  async reactivate(userId: string, actorId: string) {
    await this.approval.reactivateStaffDirect(userId, actorId);
    return { ok: true };
  }

  // ── PR-CONSULT-4: hard delete (thin wrapper) ──────────────────────
  //
  // OWNER inline path. SUPER_ADMIN's path goes through ownerOrEnqueue
  // → HARD_DELETE_STAFF executor → same direct method on the
  // approval service. The implementation lives there (same module
  // already owns `deactivateStaffDirect` / `reactivateStaffDirect`).
  async hardDeleteStaffAsOwner(args: { targetId: string; actorId: string }) {
    return this.approval.hardDeleteStaffDirect(args.targetId, args.actorId);
  }

  // ── Owner-or-enqueue dispatcher ──────────────────────────────────

  async ownerOrEnqueue(args: {
    callerRole: CallerRole;
    callerId:   string;
    actionType:
      | 'CREATE_STAFF_USER'
      | 'CHANGE_STAFF_ROLE'
      | 'DEACTIVATE_STAFF'
      | 'HARD_DELETE_STAFF';
    payload:    Record<string, unknown>;
    reason?:    string;
  }) {
    if (args.callerRole === 'OWNER') {
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
    throw new ForbiddenException(
      'Only OWNER and SUPER_ADMIN can perform this action',
    );
  }

  // PR-CONSULT-4: extended to carry profile fields through to the
  // approval service's direct-creation helper. The 4 new fields are
  // encrypted there (the helper is shared with the queued-execution
  // path so the encryption logic lives in one place).
  async createStaffUserAsOwner(args: {
    email: string;
    fullName: string;
    role: string;
    mobileNumber: string;
    countryOfResidence: string;
    address?: string;
    emergencyContact?: string;
    actorId: string;
  }) {
    return this.approval.createStaffUserDirect({
      email:              args.email,
      name:               args.fullName,
      role:               args.role,
      mobileNumber:       args.mobileNumber,
      countryOfResidence: args.countryOfResidence,
      address:            args.address,
      emergencyContact:   args.emergencyContact,
      actorId:            args.actorId,
    });
  }
}
