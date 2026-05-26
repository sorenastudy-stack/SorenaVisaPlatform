// PR-LIA-12 — Per-case access control helper for the Case File Note.
//
// Pure function, no DB. Both the view endpoint and the export endpoint
// import this to enforce the spec's per-allocation gate (not blanket
// role gate). Defence in depth on top of the controller's @Roles
// decorator.
//
// Logic mirrors the spec:
//   OWNER / ADMIN / SUPER_ADMIN — always allowed (cross-cutting roles)
//   LIA                         — only when case.liaId === user.userId
//   CONSULTANT                  — only when case.ownerId === user.userId
//                                 (Case.ownerId is the CRM owner, which
//                                 the consultant fills in this codebase)
//   anyone else                 — denied
//
// NOTE on CONSULTANT mapping: this codebase uses Case.ownerId for the
// CRM-side staff assignment (PR-LIA-2 introduced liaId as the LIA-side
// assignment). The CONSULTANT role from PR-CONSULT-1 lives on
// VisaCaseAssignment for the dashboard-side workflow, but the CRM Case
// uses ownerId for staff allocation — so we check that field.

export function canAccessCaseFileNote(
  case_: { liaId: string | null; ownerId: string | null },
  user: { userId: string; role: string },
): boolean {
  if (['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) return true;
  if (user.role === 'LIA' && case_.liaId === user.userId) return true;
  if (user.role === 'CONSULTANT' && case_.ownerId === user.userId) return true;
  return false;
}
