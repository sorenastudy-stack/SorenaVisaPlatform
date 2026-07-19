import { SetMetadata } from '@nestjs/common';

// PR-CONSULT-1 — Staff-role metadata key + decorators.
//
// Distinct from the existing `auth/decorators/roles.decorator` so
// the new StaffRolesGuard can use a separate metadata key and avoid
// changing the behaviour of every existing @Roles(...)-decorated
// route. Same wire format (SetMetadata) — just a different key.
//
// Apply alongside JwtAuthGuard + StaffRolesGuard on controllers
// where the additional "is the staff user active?" check matters.

export const STAFF_ROLES_KEY = 'staff_roles';

// The staff-portal access allow-list used by StaffRolesGuard. NOTE: this is
// the legacy guard union (a subset of UserRole values), DISTINCT from the
// Prisma `StaffRole` enum (the descriptive ADMIN/ADVISER/... taxonomy). Named
// StaffAccessRole to avoid colliding with that enum.
export type StaffAccessRole =
  | 'OWNER'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'LIA'
  | 'CONSULTANT'
  // Phase 2a: the real client Consultant (owns the client from eligibility to
  // visa result). DISTINCT from CONSULTANT, which is the "Admission Specialist"
  // on Case.ownerId. Lands on the general /staff portal like the other slots.
  | 'CLIENT_CONSULTANT'
  | 'SUPPORT'
  | 'FINANCE'
  // PR-OPS-CASES: operations staff — read-all cases + edit stage/notes only
  // (no reassignment, no risk/legal actions).
  | 'OPERATIONS';

// PR-STAFF-GATE-CONSISTENCY — the single source of truth for "who may use the
// combined /staff portal". Every route that means "any staff-portal user"
// references THIS, instead of re-typing the list (the old inline literals drifted
// and silently omitted CLIENT_CONSULTANT, locking those users out).
//
// OPERATIONS is intentionally NOT here: they are routed to /ops, not /staff (see
// the middleware ROLE_ROUTES map). Routes that legitimately include OPERATIONS
// (e.g. read-all cases, own-photo upload) list it explicitly and are a different,
// broader set — not the portal-shell set.
//
// This is an ALLOW-LIST of primary-or-secondary roles: StaffRolesGuard widens
// with secondaryRoles (hasRole), so a staff SECONDARY role also grants access —
// matching the edge middleware. A user with NO staff role (LEAD/STUDENT) matches
// nothing here and is denied.
export const STAFF_PORTAL_ROLES: StaffAccessRole[] = [
  'OWNER',
  'SUPER_ADMIN',
  'ADMIN',
  'LIA',
  'CONSULTANT',
  'CLIENT_CONSULTANT',
  'SUPPORT',
  'FINANCE',
];

// Allow ANY of the listed roles.
export const StaffRoles = (...roles: StaffAccessRole[]) =>
  SetMetadata(STAFF_ROLES_KEY, roles);

// Convenience for OWNER-only routes.
export const OwnerOnly = () => SetMetadata(STAFF_ROLES_KEY, ['OWNER']);

// Convenience for the OWNER / SUPER_ADMIN / ADMIN trio that can
// view all cases, allocate staff, and reassign slots.
export const AdminTier = () =>
  SetMetadata(STAFF_ROLES_KEY, ['OWNER', 'SUPER_ADMIN', 'ADMIN']);
