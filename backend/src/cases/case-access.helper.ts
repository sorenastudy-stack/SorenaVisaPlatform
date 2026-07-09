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
// Distinct from canAccessCaseFileNote above (which is per-allocation for the
// file-note view, restricting LIA to their own liaId). This gate follows the
// locked Operations-Manual read model, where LIA sees ALL case data:
//
//   OWNER / ADMIN / SUPER_ADMIN — always (cross-cutting admin tier)
//   LIA                         — always (sees all cases per the model)
//   CONSULTANT (Admission Spec) — only when case.ownerId      === user.userId
//   CLIENT_CONSULTANT           — only when case.consultantId === user.userId
//   SUPPORT (Pastoral Care)     — only when case.supportId    === user.userId
//   FINANCE                     — only when case.financeId    === user.userId
//   anyone else (incl. clients) — denied
//
// The five slot columns match the auto-assignment slots (owner/lia/support/
// finance/consultant). Clients read their own case via the separate /portal/me
// and /students/me routes, not this surface — so they are correctly denied here.
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
  if (user.role === 'LIA') return true;
  if (user.role === 'CONSULTANT' && case_.ownerId === user.userId) return true;
  if (user.role === 'CLIENT_CONSULTANT' && case_.consultantId === user.userId) return true;
  if (user.role === 'SUPPORT' && case_.supportId === user.userId) return true;
  if (user.role === 'FINANCE' && case_.financeId === user.userId) return true;
  return false;
}
