// Option C step 2 — single source of truth for post-login route
// dispatch by user role. Imported by:
//   - src/app/login/page.tsx       (password login redirect)
//   - src/app/auth/callback/page.tsx (Google OAuth redirect)
//
// PR-CONSULT-2: all 7 staff roles land on the unified `/staff`
// portal. STUDENT keeps the existing dashboard route. The legacy
// per-role shells (/admin, /ops, /sales, /lia) still exist and
// remain reachable by direct URL.

export const ROLE_REDIRECT: Record<string, string> = {
  OWNER:       '/staff',
  SUPER_ADMIN: '/staff',
  ADMIN:       '/staff',
  OPERATIONS:  '/ops',
  SALES:       '/sales',
  LIA:         '/staff',
  CONSULTANT:  '/staff',
  SUPPORT:     '/staff',
  FINANCE:     '/staff',
  STUDENT:     '/student/dashboard',
};

export function routeForRole(role: string | null | undefined, fallback = '/student'): string {
  if (!role) return fallback;
  return ROLE_REDIRECT[role] ?? fallback;
}
