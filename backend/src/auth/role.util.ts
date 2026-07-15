// Secondary-roles permission helper (backend).
//
// Secondary roles WIDEN access only. A user is allowed if their PRIMARY `role`
// OR any of their `secondaryRoles` is in the allowed set. This is the single
// place the "primary OR secondary" rule lives on the backend — RolesGuard and
// any other permission check call it, so widening behaviour stays consistent.
//
// It NEVER narrows: an empty `secondaryRoles` (the default for every existing
// user) makes this behave exactly like the old `allowed.includes(role)` check.

export function hasRole(
  user:
    | { role?: string | null; secondaryRoles?: readonly string[] | null }
    | null
    | undefined,
  ...allowed: string[]
): boolean {
  if (!user) return false;
  if (user.role && allowed.includes(user.role)) return true;
  const secondary = user.secondaryRoles ?? [];
  for (const r of secondary) {
    if (allowed.includes(r)) return true;
  }
  return false;
}
