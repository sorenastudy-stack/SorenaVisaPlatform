// PR-CONSULT-3 — Staff users shared types.
//
// Matches the GET /api/staff/users + /api/staff/users/:id response
// shape from PR-CONSULT-1's StaffUsersService.

import type { StaffRole } from '@/contexts/StaffContext';

export interface StaffUserRow {
  id:        string;
  email:     string;
  name:      string;
  role:      StaffRole;
  createdAt: string;
  isActive:  boolean;
}

// PR-CONSULT-4 — Staff detail response (decrypted profile fields +
// archive metadata). Matches GET /api/staff/users/:id.
export interface StaffUserDetail extends StaffUserRow {
  mobileNumber:       string | null;
  countryOfResidence: string | null;
  address:            string | null;
  emergencyContact:   string | null;
  archivedAt:         string | null;
  archivedById:       string | null;
  archivedByName:     string | null;
}

// Roles available in the Create + Change-role dropdowns. Excludes
// STUDENT (not a staff role) and OWNER (intentionally non-promotable
// from the UI — handover doc covers the DB-direct promotion).
export const ASSIGNABLE_ROLES: StaffRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'LIA',
  'CONSULTANT',
  // Phase 2a: the real client Consultant slot (Case.consultantId).
  'CLIENT_CONSULTANT',
  'SUPPORT',
  'FINANCE',
];

// Two-path response from PR-CONSULT-1's ownerOrEnqueue dispatcher.
// OWNER inline → EXECUTED (sometimes carrying tempPassword on the
// CREATE_STAFF_USER path); SUPER_ADMIN → PENDING_OWNER_APPROVAL.
export type ActionResult =
  | { status: 'EXECUTED'; userId?: string; email?: string; role?: string; tempPassword?: string }
  | { status: 'PENDING_OWNER_APPROVAL'; requestId: string };

export function isExecutedWithPassword(
  result: ActionResult,
): result is { status: 'EXECUTED'; userId: string; email: string; role: string; tempPassword: string } {
  return result.status === 'EXECUTED' && typeof (result as { tempPassword?: unknown }).tempPassword === 'string';
}

export function isPendingApproval(
  result: ActionResult,
): result is { status: 'PENDING_OWNER_APPROVAL'; requestId: string } {
  return result.status === 'PENDING_OWNER_APPROVAL';
}
