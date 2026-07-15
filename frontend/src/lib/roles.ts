// Secondary-roles permission helper (frontend).
//
// Mirrors backend/src/auth/role.util.ts — a parallel implementation because the
// frontend and backend run in separate processes and can't share a module. The
// rule is identical: WIDEN only. Allowed if the PRIMARY role OR any secondary
// role is in the allowed set. Empty secondaryRoles → behaves exactly like the
// old `allowed.includes(role)` check, so it never narrows access.
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
