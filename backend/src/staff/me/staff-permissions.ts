// PR-CONSULT-2 — Staff permission helper.
//
// Single source of truth for the frontend's `permissions` shape on
// /api/staff/me. The frontend reads these and uses a small
// PermissionGate component to show / hide nav items + action
// buttons. Keep this aligned with the StaffRolesGuard + AdminTier
// helpers on the backend — but note this returns BOOLS for the UI
// and the guards enforce the same boolean answer on the server.
//
// Tier reminder (from PR-CONSULT-1):
//   OWNER         — full access, only role that can approve queue items.
//   SUPER_ADMIN   — same as OWNER except destructive actions are queued.
//   ADMIN         — read-all, manage cases / staff (no approvals queue).
//   LIA / CONSULTANT / SUPPORT / FINANCE — scoped to own assignments.

import type { StaffRole } from '../roles/staff-roles.decorator';

export interface StaffPermissions {
  // Can open the /staff/users CRUD page + invite / deactivate staff.
  canManageStaff:   boolean;
  // Can approve / reject items in the owner-approval queue.
  canApprove:       boolean;
  // Can see every VisaCase regardless of assignment (admin tier).
  // Non-admin staff see only cases where they hold an active
  // assignment in some role slot.
  canSeeAllCases:   boolean;
  // Can use the "Reassign" overlay on the case detail.
  canReassign:      boolean;
}

export function staffPermissions(role: StaffRole | string): StaffPermissions {
  const isOwner = role === 'OWNER';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN';
  const adminTier = isOwner || isSuperAdmin || isAdmin;
  return {
    canManageStaff: adminTier,
    canApprove:     isOwner,
    canSeeAllCases: adminTier,
    canReassign:    adminTier,
  };
}
