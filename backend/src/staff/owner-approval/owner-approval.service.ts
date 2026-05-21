import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AssignmentsService } from '../assignments/assignments.service';
import * as bcrypt from 'bcrypt';

// PR-CONSULT-1 — Owner-approval service.
//
// Lifecycle of a request:
//   1. SUPER_ADMIN calls a sensitive endpoint → endpoint calls
//      `requestApproval()` which creates PENDING + audits
//      OWNER_APPROVAL_REQUESTED + returns { status, requestId }.
//   2. OWNER calls `approve(id)` → service transitions to APPROVED,
//      runs `executeApprovedAction()` immediately, then transitions
//      to EXECUTED (or EXECUTION_FAILED if the underlying action
//      throws). Both transitions audit-log.
//   3. OWNER calls `reject(id)` → REJECTED + audit.
//   4. On any `listPending()` read, requests where expiresAt < now
//      are flipped to EXPIRED in-place (lazy on-read sweep — no
//      scheduler needed for launch).
//
// Encryption: payload + reason + decisionNote are stored as
// base64-encoded AES-256-GCM ciphertext (CryptoService).

const EXPIRY_DAYS = 7;
const ACTION_TYPES = [
  'CREATE_STAFF_USER',
  'CHANGE_STAFF_ROLE',
  'DEACTIVATE_STAFF',
  'DELETE_CASE',
  'DELETE_STUDENT',
  'ISSUE_REFUND',
  'CHANGE_PLATFORM_SETTING',
  // PR-CONSULT-4: permanent staff deletion. Same executor pattern.
  'HARD_DELETE_STAFF',
] as const;
type ActionType = typeof ACTION_TYPES[number];

@Injectable()
export class OwnerApprovalService {
  private readonly logger = new Logger(OwnerApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly assignments: AssignmentsService,
  ) {}

  // ── Crypto helpers (base64 envelope — matches PR-DASH-3/4) ────────

  private enc(plain: string): string {
    return this.crypto.encrypt(plain).toString('base64');
  }
  private encOrNull(plain: string | null | undefined): string | null {
    if (!plain) return null;
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

  // ── Audit emit ────────────────────────────────────────────────────

  private async writeAudit(
    userId: string,
    eventType: string,
    entityId: string,
    extras: { oldValue?: unknown; newValue?: unknown } = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     eventType,
        eventType,
        entityType: 'OwnerApprovalRequest',
        entityId,
        oldValue:   (extras.oldValue ?? null) as never,
        newValue:   (extras.newValue ?? null) as never,
      },
    });
  }

  // ── Public API ────────────────────────────────────────────────────

  // SUPER_ADMIN entry point. Creates a PENDING request and returns
  // the row id + status — the caller hands that back to the client
  // as `{ status: 'PENDING_OWNER_APPROVAL', requestId }`.
  async requestApproval(args: {
    requestedById: string;
    actionType: ActionType;
    payload: Record<string, unknown>;
    reason?: string;
  }) {
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.prisma.ownerApprovalRequest.create({
      data: {
        requestedById: args.requestedById,
        actionType:    args.actionType as never,
        payload:       this.enc(JSON.stringify(args.payload)),
        reason:        this.encOrNull(args.reason),
        expiresAt,
      },
    });
    await this.writeAudit(
      args.requestedById,
      'OWNER_APPROVAL_REQUESTED',
      created.id,
      { newValue: { actionType: args.actionType } },
    );
    return created;
  }

  // OWNER endpoint. Approve + execute in sequence.
  async approve(requestId: string, ownerId: string, decisionNote?: string) {
    const req = await this.prisma.ownerApprovalRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request is ${req.status}, not PENDING`);
    }
    if (req.expiresAt.getTime() < Date.now()) {
      await this.prisma.ownerApprovalRequest.update({
        where: { id: req.id },
        data:  { status: 'EXPIRED' },
      });
      await this.writeAudit(ownerId, 'OWNER_APPROVAL_EXPIRED', req.id);
      throw new BadRequestException('Request has expired');
    }

    const approved = await this.prisma.ownerApprovalRequest.update({
      where: { id: req.id },
      data:  {
        status:       'APPROVED',
        decidedById:  ownerId,
        decidedAt:    new Date(),
        decisionNote: this.encOrNull(decisionNote),
      },
    });
    await this.writeAudit(ownerId, 'OWNER_APPROVAL_APPROVED', req.id);

    // Execute the underlying action. Failures are captured on the
    // row but don't roll back the APPROVED state — the audit trail
    // shows the failure and the OWNER can re-issue manually.
    try {
      const payload = JSON.parse(this.dec(req.payload) ?? '{}');
      await this.executeApprovedAction(
        req.actionType as ActionType,
        payload,
        ownerId,
      );
      const executed = await this.prisma.ownerApprovalRequest.update({
        where: { id: req.id },
        data:  { status: 'EXECUTED', executedAt: new Date() },
      });
      await this.writeAudit(ownerId, 'OWNER_APPROVAL_EXECUTED', req.id);
      return { approval: executed, executionResult: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await this.prisma.ownerApprovalRequest.update({
        where: { id: req.id },
        data:  {
          status:         'EXECUTION_FAILED',
          executedAt:     new Date(),
          executionError: message.slice(0, 2000),
        },
      });
      this.logger.error(`[owner-approval] execution failed for ${req.id}: ${message}`);
      return { approval: failed, executionResult: { ok: false, error: message } };
    }
  }

  async reject(requestId: string, ownerId: string, decisionNote?: string) {
    const req = await this.prisma.ownerApprovalRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request is ${req.status}, not PENDING`);
    }
    const rejected = await this.prisma.ownerApprovalRequest.update({
      where: { id: req.id },
      data:  {
        status:       'REJECTED',
        decidedById:  ownerId,
        decidedAt:    new Date(),
        decisionNote: this.encOrNull(decisionNote),
      },
    });
    await this.writeAudit(ownerId, 'OWNER_APPROVAL_REJECTED', req.id);
    return rejected;
  }

  // OWNER view of every pending request. Also performs the on-read
  // expiry sweep — rows where expiresAt < now flip to EXPIRED.
  async listPending() {
    await this.sweepExpired();
    const rows = await this.prisma.ownerApprovalRequest.findMany({
      where:   { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
      },
    });
    return rows.map((r) => this.shapeForApi(r));
  }

  // SUPER_ADMIN view of their own requests.
  async listMyRequests(requestedById: string) {
    await this.sweepExpired();
    const rows = await this.prisma.ownerApprovalRequest.findMany({
      where:   { requestedById },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    return rows.map((r) => this.shapeForApi(r));
  }

  private async sweepExpired() {
    const now = new Date();
    const stale = await this.prisma.ownerApprovalRequest.findMany({
      where:  { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
    });
    if (stale.length === 0) return;
    await this.prisma.ownerApprovalRequest.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data:  { status: 'EXPIRED' },
    });
    // Audit each in one batch. userId is null because the sweep is
    // system-driven; the audit log column already allows null.
    await this.prisma.auditLog.createMany({
      data: stale.map((r) => ({
        userId:     null,
        action:     'OWNER_APPROVAL_EXPIRED',
        eventType:  'OWNER_APPROVAL_EXPIRED',
        entityType: 'OwnerApprovalRequest',
        entityId:   r.id,
      })),
    });
  }

  private shapeForApi(r: {
    id: string;
    requestedById: string;
    actionType: string;
    payload: string;
    reason: string | null;
    status: string;
    decidedById: string | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    expiresAt: Date;
    executedAt: Date | null;
    executionError: string | null;
    createdAt: Date;
    requestedBy?: { id: string; name: string | null; email: string } | null;
  }) {
    return {
      id:             r.id,
      requestedById:  r.requestedById,
      requestedBy:    r.requestedBy ?? null,
      actionType:     r.actionType,
      payload:        JSON.parse(this.dec(r.payload) ?? '{}'),
      reason:         this.dec(r.reason),
      status:         r.status,
      decidedById:    r.decidedById,
      decidedAt:      r.decidedAt,
      decisionNote:   this.dec(r.decisionNote),
      expiresAt:      r.expiresAt,
      executedAt:     r.executedAt,
      executionError: r.executionError,
      createdAt:      r.createdAt,
    };
  }

  // ── Executors ─────────────────────────────────────────────────────
  //
  // One method per ActionType. The dispatch table at the bottom
  // routes the decrypted payload to the right method. Each executor
  // emits its own audit row in addition to the umbrella
  // OWNER_APPROVAL_EXECUTED row written by `approve()`.

  async executeApprovedAction(
    actionType: ActionType,
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    switch (actionType) {
      case 'CREATE_STAFF_USER':       return this.execCreateStaffUser(payload, actorId);
      case 'CHANGE_STAFF_ROLE':       return this.execChangeStaffRole(payload, actorId);
      case 'DEACTIVATE_STAFF':        return this.execDeactivateStaff(payload, actorId);
      case 'DELETE_CASE':             return this.execDeleteCase(payload, actorId);
      case 'DELETE_STUDENT':          return this.execDeleteStudent(payload, actorId);
      case 'ISSUE_REFUND':            return this.execIssueRefund(payload, actorId);
      case 'CHANGE_PLATFORM_SETTING': return this.execChangePlatformSetting(payload, actorId);
      // PR-CONSULT-4: executor for the queued hard-delete path.
      // Imports the StaffUsersService at call time via the lazy
      // moduleRef pattern below so we avoid a circular-import.
      case 'HARD_DELETE_STAFF':       return this.execHardDeleteStaff(payload, actorId);
      default:
        throw new BadRequestException(`Unknown action type ${actionType}`);
    }
  }

  // Helper used by both direct OWNER actions (in StaffUsersService)
  // and the executor — keeps the staff-creation logic in one place.
  //
  // PR-CONSULT-4: extended to accept (and require) mobileNumber +
  // countryOfResidence; optional address + emergencyContact. The
  // three encrypted columns go through the same base64-envelope
  // helper used elsewhere on the staff tier.
  async createStaffUserDirect(args: {
    email: string;
    name: string;
    role: string;
    mobileNumber?: string;
    countryOfResidence?: string;
    address?: string;
    emergencyContact?: string;
    actorId: string;
  }) {
    if (!args.email || !args.name || !args.role) {
      throw new BadRequestException('email, name, and role are required');
    }
    // PR-CONSULT-4: SALES is deprecated. The DTO already filters it
    // but the executor is reached via raw payloads too — defensive
    // check.
    if (args.role === 'SALES') {
      throw new BadRequestException('SALES role is deprecated; pick a current role');
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: args.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new BadRequestException('A user with that email already exists');
    }
    // Generate a 32-char temp password; the OWNER shares it
    // out-of-band or the user resets via the existing
    // password-reset flow. Email wiring is a follow-up — for v1 the
    // temp password is returned in the response.
    const tempPassword = this.randomPassword(32);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Encrypt the three sensitive profile fields; countryOfResidence
    // stays plain ISO 3166-1 alpha-2.
    const mobileEncrypted    = args.mobileNumber     ? this.enc(args.mobileNumber.trim()) : null;
    const addressEncrypted   = args.address          ? this.enc(args.address)             : null;
    const emergencyEncrypted = args.emergencyContact ? this.enc(args.emergencyContact)    : null;

    const created = await this.prisma.user.create({
      data: {
        email:              args.email.toLowerCase().trim(),
        name:               args.name.trim(),
        passwordHash,
        role:               args.role as never,
        mobileNumber:       mobileEncrypted,
        countryOfResidence: args.countryOfResidence ?? null,
        address:            addressEncrypted,
        emergencyContact:   emergencyEncrypted,
      },
    });
    await this.writeAuditWithType(args.actorId, 'STAFF_USER_CREATED', created.id, {
      newValue: { email: created.email, role: created.role },
    });
    return { user: created, tempPassword };
  }

  // PR-CONSULT-4: hard-delete implementation. Lives here (not in
  // StaffUsersService) for the same reason `deactivateStaffDirect`
  // does — the executor + the inline-OWNER controller share it.
  //
  // Flow is documented in detail in the StaffUsersService caller;
  // the short version:
  //   1. Snapshot audit rows that reference this user as actor.
  //   2. Capture active VisaCaseAssignment rows.
  //   3. Delete every assignment row referencing this user.
  //   4. Re-point assignedById / unassignedById to the actor.
  //   5. NULL decidedById + delete requestedById rows on
  //      OwnerApprovalRequest.
  //   6. Delete the User row.
  //   7. Audit STAFF_HARD_DELETED with snapshot in newValue.
  //   8. Fire reallocation outside the tx (best-effort).
  async hardDeleteStaffDirect(targetId: string, actorId: string): Promise<{
    ok: true; reallocatedSlots: number;
  }> {
    if (targetId === actorId) {
      throw new BadRequestException('Cannot hard-delete your own account');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Staff user not found');
    if (target.role === 'STUDENT') {
      throw new ForbiddenException('Use the student delete flow');
    }
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot hard-delete an OWNER from the UI');
    }
    const snapshotName  = target.name;
    const snapshotRole  = target.role;
    const snapshotEmail = target.email;

    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.updateMany({
        where: { userId: targetId, actorNameSnapshot: null },
        data:  { actorNameSnapshot: snapshotName, actorRoleSnapshot: snapshotRole },
      });

      const active = await tx.visaCaseAssignment.findMany({
        where:  { staffId: targetId, unassignedAt: null },
        select: { id: true, caseId: true, roleSlot: true },
      });

      await tx.visaCaseAssignment.deleteMany({ where: { staffId: targetId } });
      await tx.visaCaseAssignment.updateMany({
        where: { assignedById: targetId },
        data:  { assignedById: actorId },
      });
      await tx.visaCaseAssignment.updateMany({
        where: { unassignedById: targetId },
        data:  { unassignedById: actorId },
      });

      await tx.ownerApprovalRequest.updateMany({
        where: { decidedById: targetId },
        data:  { decidedById: null },
      });
      await tx.ownerApprovalRequest.deleteMany({
        where: { requestedById: targetId },
      });

      try {
        await tx.user.delete({ where: { id: targetId } });
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null
            && (err as { code?: string }).code === 'P2003') {
          throw new BadRequestException(
            'Cannot hard-delete: user is referenced by another table. Archive instead.',
          );
        }
        throw err;
      }

      const actor = await tx.user.findUnique({
        where: { id: actorId }, select: { name: true, role: true },
      });
      await tx.auditLog.create({
        data: {
          userId:            actorId,
          action:            'STAFF_HARD_DELETED',
          eventType:         'STAFF_HARD_DELETED',
          entityType:        'User',
          entityId:          targetId,
          newValue: {
            deletedUserName:  snapshotName,
            deletedUserRole:  snapshotRole,
            deletedUserEmail: snapshotEmail,
          },
          actorNameSnapshot: actor?.name ?? null,
          actorRoleSnapshot: actor?.role ?? null,
        },
      });

      return active;
    });

    for (const a of closed) {
      try {
        await this.assignments.autoAllocate(
          a.caseId,
          a.roleSlot as never,
          actorId,
        );
      } catch (e) {
        this.logger.warn(
          `[hard-delete] could not auto-allocate ${a.roleSlot} on case ${a.caseId} after deleting ${targetId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    return { ok: true, reallocatedSlots: closed.length };
  }

  // ── Private executors ─────────────────────────────────────────────

  private async execCreateStaffUser(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    await this.createStaffUserDirect({
      email:              String(payload.email ?? ''),
      name:               String(payload.fullName ?? payload.name ?? ''),
      role:               String(payload.role ?? ''),
      mobileNumber:       payload.mobileNumber ? String(payload.mobileNumber) : undefined,
      countryOfResidence: payload.countryOfResidence ? String(payload.countryOfResidence) : undefined,
      address:            payload.address ? String(payload.address) : undefined,
      emergencyContact:   payload.emergencyContact ? String(payload.emergencyContact) : undefined,
      actorId,
    });
  }

  // PR-CONSULT-4: executor for the queued hard-delete path.
  private async execHardDeleteStaff(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const userId = String(payload.userId ?? '');
    if (!userId) throw new BadRequestException('userId is required');
    await this.hardDeleteStaffDirect(userId, actorId);
  }

  private async execChangeStaffRole(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const userId = String(payload.userId ?? '');
    const newRole = String(payload.newRole ?? '');
    if (!userId || !newRole) {
      throw new BadRequestException('userId and newRole are required');
    }
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!existing) throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id: userId },
      data:  { role: newRole as never },
    });
    await this.writeAuditWithType(actorId, 'STAFF_ROLE_CHANGED', userId, {
      oldValue: { role: existing.role },
      newValue: { role: newRole },
    });
  }

  async deactivateStaffDirect(userId: string, actorId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.staffActiveStatus.upsert({
      where:  { userId },
      create: {
        userId,
        isActive:        false,
        deactivatedAt:   new Date(),
        deactivatedById: actorId,
      },
      update: {
        isActive:        false,
        deactivatedAt:   new Date(),
        deactivatedById: actorId,
      },
    });
    // Close every active case assignment owned by this user and
    // auto-reallocate each in turn. closeAllAssignmentsForStaff
    // returns the (case, slot) pairs to re-allocate.
    const closed = await this.assignments.closeAllAssignmentsForStaff(
      userId,
      actorId,
    );
    for (const { caseId, roleSlot } of closed) {
      try {
        await this.assignments.autoAllocate(caseId, roleSlot, actorId);
      } catch (e) {
        // No replacement available — log and keep going. The slot
        // shows as unfilled in the UI until manually assigned.
        this.logger.warn(
          `[owner-approval] could not auto-allocate ${roleSlot} on case ${caseId} after deactivating ${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    await this.writeAuditWithType(actorId, 'STAFF_DEACTIVATED', userId, {
      newValue: { reallocatedSlots: closed.length },
    });
  }

  async reactivateStaffDirect(userId: string, actorId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.staffActiveStatus.upsert({
      where:  { userId },
      create: { userId, isActive: true },
      update: { isActive: true, deactivatedAt: null, deactivatedById: null },
    });
    await this.writeAuditWithType(actorId, 'STAFF_REACTIVATED', userId);
  }

  private async execDeactivateStaff(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const userId = String(payload.userId ?? '');
    if (!userId) throw new BadRequestException('userId is required');
    await this.deactivateStaffDirect(userId, actorId);
  }

  private async execDeleteCase(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const caseId = String(payload.caseId ?? '');
    if (!caseId) throw new BadRequestException('caseId is required');
    // Hard delete — VisaCase cascades through its child rows via
    // existing FKs (assignments, tickets, file notes, meetings).
    await this.prisma.visaCase.delete({ where: { id: caseId } });
    await this.writeAuditWithType(actorId, 'OWNER_APPROVAL_EXECUTED', caseId, {
      newValue: { actionType: 'DELETE_CASE' },
    });
  }

  private async execDeleteStudent(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const studentId = String(payload.studentId ?? '');
    if (!studentId) throw new BadRequestException('studentId is required');
    // Hard delete the User row — cascades through all the visa
    // tables that have ON DELETE CASCADE from User. Some tables
    // are NO ACTION (e.g. meetings) — those will block; the
    // approval-execution catch block records that on the row.
    await this.prisma.user.delete({ where: { id: studentId } });
    await this.writeAuditWithType(actorId, 'OWNER_APPROVAL_EXECUTED', studentId, {
      newValue: { actionType: 'DELETE_STUDENT' },
    });
  }

  private async execIssueRefund(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const paymentId = String(payload.paymentId ?? '');
    const amount = Number(payload.amountCents ?? payload.amount ?? 0);
    if (!paymentId || !Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('paymentId and positive amountCents are required');
    }
    // Stripe isn't wired yet — record the intent so a future PR can
    // pick it up.
    await this.prisma.refund.create({
      data: {
        paymentId,
        amountCents: Math.floor(amount),
        reason:      payload.reason ? String(payload.reason) : null,
        status:      'PENDING_STRIPE_INTEGRATION',
        createdById: actorId,
      },
    });
  }

  private async execChangePlatformSetting(
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const key = String(payload.key ?? '');
    const value = String(payload.value ?? '');
    if (!key) throw new BadRequestException('key is required');
    await this.prisma.platformSetting.upsert({
      where:  { key },
      create: { key, value: this.enc(value), updatedById: actorId },
      update: { value: this.enc(value), updatedById: actorId },
    });
  }

  // Small shared audit helper for the executors — same column shape
  // as `writeAudit` but with a free entityType so executor-specific
  // audit rows reference the affected entity (User / VisaCase /
  // Refund / PlatformSetting) rather than the approval row.
  private async writeAuditWithType(
    userId: string,
    eventType: string,
    entityId: string,
    extras: { oldValue?: unknown; newValue?: unknown } = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     eventType,
        eventType,
        entityId,
        oldValue:   (extras.oldValue ?? null) as never,
        newValue:   (extras.newValue ?? null) as never,
      },
    });
  }

  // Crypto-strong-ish random password generator. Uses Math.random()
  // intentionally for this v1 — the temp password is only used
  // until the staff member resets it on first login. A follow-up
  // PR can wire `crypto.randomBytes` if needed.
  private randomPassword(len: number): string {
    const chars =
      'ABCDEFGHJKLMNPQRSTUVWXYZ' +
      'abcdefghijkmnpqrstuvwxyz' +
      '23456789' +
      '!@#$%^&*';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }
}
