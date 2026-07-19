// Secondary-roles permission helper (frontend).
//
// Mirrors backend/src/auth/role.util.ts — a parallel implementation because the
// frontend and backend run in separate processes and can't share a module. The
// rule is identical: WIDEN only. Allowed if the PRIMARY role OR any secondary
// role is in the allowed set. Empty secondaryRoles → behaves exactly like the
// old `allowed.includes(role)` check, so it never narrows access.

// PR-STAFF-GATE-CONSISTENCY — the single frontend source of truth for "who may
// use the combined /staff portal". Both the edge middleware (ROLE_ROUTES['/staff'])
// and the /staff layout gate reference THIS, so they can't drift apart the way
// the old hand-copied literals did (which silently omitted CLIENT_CONSULTANT).
//
// Mirrors backend STAFF_PORTAL_ROLES (separate process → can't import it). Both
// gates pass this to hasRole(), so a staff PRIMARY or SECONDARY role grants
// access; a user with no staff role (LEAD/STUDENT) matches nothing and is denied.
// OPERATIONS is intentionally excluded — they route to /ops, not /staff.
export const STAFF_PORTAL_ROLES = [
  'OWNER',
  'SUPER_ADMIN',
  'ADMIN',
  'LIA',
  'CONSULTANT',
  'CLIENT_CONSULTANT',
  'SUPPORT',
  'FINANCE',
] as const;
export function hasRole(
  primaryRole: string | null | undefined,
  secondaryRoles: readonly string[] | null | undefined,
  allowed: readonly string[],
): boolean {
  if (primaryRole && allowed.includes(primaryRole)) return true;
  for (const r of secondaryRoles ?? []) {
    if (allowed.includes(r)) return true;
  }
  return false;
}
