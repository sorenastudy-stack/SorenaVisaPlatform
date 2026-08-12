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

// Phase 5a — Per-case READ gate for GET /cases and GET /cases/:id.
//
// Every working role is scoped to the cases it is actually allocated to:
//
//   OWNER / ADMIN / SUPER_ADMIN — always (cross-cutting admin tier)
//   LIA (Immigration Adviser)   — only when case.liaId        === user.userId
//   CONSULTANT (Admission Spec) — only when case.ownerId      === user.userId
//   CLIENT_CONSULTANT           — only when case.consultantId === user.userId
//   SUPPORT (Pastoral Care)     — only when case.supportId    === user.userId
//   FINANCE                     — only when case.financeId    === user.userId
//   anyone else (incl. clients) — denied
//
// The five slot columns match the auto-assignment slots (owner/lia/support/
// finance/consultant). Clients read their own case via the separate /portal/me
// and /students/me routes, not this surface — so they are correctly denied here.
//
// LIA WAS "always true" here — the blanket read model — while
// canAccessCaseFileNote above scoped the same role to its own liaId. The two
// gates contradicted each other on the same role for the same case, and the
// permissive one governed nineteen endpoints including legal notes, INZ
// submissions and payments.
//
// Restricted 2026-08-12 on the Owner's decision: LIAs only ever work their own
// assigned clients in practice, and no cross-case coverage workflow exists, so
// this needs no override or coverage mechanism behind it. An LIA who must work
// another adviser's case is assigned to it.
//
// ⚠ DOCUMENTATION DEBT: the removed comment cited the Operations Manual as the
// authority for the blanket model. That document still describes the old rule
// and must be updated separately — the code and the manual now disagree, and
// the manual is the one that is out of date.
export function canReadCase(
  case_: {
    ownerId: string | null;
    liaId: string | null;
    supportId: string | null;
    financeId: string | null;
    consultantId: string | null;
  },
  user: { userId: string; role: string },
): boolean {
  if (['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) return true;
  if (user.role === 'LIA' && case_.liaId === user.userId) return true;
  if (user.role === 'CONSULTANT' && case_.ownerId === user.userId) return true;
  if (user.role === 'CLIENT_CONSULTANT' && case_.consultantId === user.userId) return true;
  if (user.role === 'SUPPORT' && case_.supportId === user.userId) return true;
  if (user.role === 'FINANCE' && case_.financeId === user.userId) return true;
  return false;
}
