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

export type StaffRole =
  | 'OWNER'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'LIA'
  | 'CONSULTANT'
  | 'SUPPORT'
  | 'FINANCE';

// Allow ANY of the listed roles.
export const StaffRoles = (...roles: StaffRole[]) =>
  SetMetadata(STAFF_ROLES_KEY, roles);

// Convenience for OWNER-only routes.
export const OwnerOnly = () => SetMetadata(STAFF_ROLES_KEY, ['OWNER']);

// Convenience for the OWNER / SUPER_ADMIN / ADMIN trio that can
// view all cases, allocate staff, and reassign slots.
export const AdminTier = () =>
  SetMetadata(STAFF_ROLES_KEY, ['OWNER', 'SUPER_ADMIN', 'ADMIN']);
