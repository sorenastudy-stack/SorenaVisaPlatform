# PHASE-P — Staff gate consistency (CLIENT_CONSULTANT lockout fix)

Three independent gates guard the combined `/staff` portal. They had each
hand-copied the "staff roles" list, the copies drifted, and all three omitted
`CLIENT_CONSULTANT` — locking every client-consultant out of the portal (403 on
`/api/staff/me`, a broken shell, and an `/unauthorized` bounce). Worse, the three
gates enforced the list *differently*: the edge middleware widened with secondary
roles; the layout and the backend guard checked the primary role only. This PR
removes the divergence by construction: **one shared role constant per process,
and all three gates widen with secondary roles the same way.**

## 1. What this PR does

- Introduces **`STAFF_PORTAL_ROLES`** — the single source of truth for "who may
  use the `/staff` portal" — one constant on each side of the process boundary
  (backend + frontend can't share a module).
- Makes the two primary-only gates **widen with secondary roles** via `hasRole`,
  matching the edge middleware that already did. All three gates now compute the
  same allow/deny from the same set.
- Adds **`CLIENT_CONSULTANT`** to that set (it was the missing role) and replaces
  the drifted 7-role literal in **10 backend routes** + the 3 gates.
- No schema/data/endpoint-shape change — pure authorization wiring.

## 2. Root cause (the three gates, before)

| # | Gate | Role set | Widened? |
|---|---|---|---|
| 1 | Edge `middleware.ts` `ROLE_ROUTES['/staff']` | 7-role literal (no `CLIENT_CONSULTANT`) | **Yes** (`hasRole`) |
| 2 | `app/staff/layout.tsx` `STAFF_ROLES` Set | same 7-role literal | **No** — `Set.has(session.role)` |
| 3 | `StaffRolesGuard` + `@StaffRoles` on `/api/staff/me` | same 7-role literal (×10 routes) | **No** — `required.includes(user.role)` |

The 7-role list was **duplicated as inline literals** in every gate (and 10
backend routes), never shared. The codebase's *correct* set already existed as a
local `ALL_STAFF` const in `staff-photo.controller.ts` (with `CLIENT_CONSULTANT`)
but was never referenced by the gates. The duplication — not a single typo — was
the bug. `CLIENT_CONSULTANT` is a legitimate staff role (`StaffAccessRole` union +
enum comment: *"the real client Consultant … lands on the general /staff portal"*).

## 3. The fix (consistent, not a patch)

**`STAFF_PORTAL_ROLES` = 8 roles:** `OWNER, SUPER_ADMIN, ADMIN, LIA, CONSULTANT,
CLIENT_CONSULTANT, SUPPORT, FINANCE`.

- **Backend** — `backend/src/staff/roles/staff-roles.decorator.ts` exports
  `STAFF_PORTAL_ROLES`. `StaffRolesGuard` now widens: `hasRole(user, ...required)`
  (reusing `auth/role.util.ts`) instead of `required.includes(user.role)`. The 10
  "any staff-portal user" routes use `@StaffRoles(...STAFF_PORTAL_ROLES)`.
- **Frontend** — `frontend/src/lib/roles.ts` exports `STAFF_PORTAL_ROLES` (mirror,
  documented). `middleware.ts` sets `ROLE_ROUTES['/staff'] = [...STAFF_PORTAL_ROLES]`;
  `app/staff/layout.tsx` gates on
  `hasRole(session.role, session.secondaryRoles, STAFF_PORTAL_ROLES)`.

Because every gate references its side's single constant and runs the same
`hasRole` widening, the three agree **by construction** — a future edit changes
one place, and the class of bug can't silently recur.

**Why `OPERATIONS` is excluded:** the middleware routes `OPERATIONS` to `/ops`,
not `/staff` — a separate, intentional set. Routes that legitimately include
`OPERATIONS` (read-all cases, own-photo upload) list it explicitly and are a
broader set, left untouched. Adding it to `/staff` would have been an unrequested
access change.

## 4. Files changed

- **Backend (canonical + widen):** `staff/roles/staff-roles.decorator.ts` (new
  `STAFF_PORTAL_ROLES`), `staff/roles/staff-roles.guard.ts` (`hasRole` widening).
- **Backend (10 routes → shared constant):** `staff/me/staff-me.controller.ts`,
  `staff/hr/staff-hr.controller.ts`, `staff/leave/staff-leave.controller.ts`,
  `staff/assignments/assignments.controller.ts`,
  `documents/staff-documents.controller.ts`.
- **Frontend:** `lib/roles.ts` (new `STAFF_PORTAL_ROLES`), `middleware.ts`
  (`/staff` → shared constant), `app/staff/layout.tsx` (widen via `hasRole`).
- **Test (gitignored):** `backend/scripts/test-staff-gate-consistency.ts`.

## 5. Configuration

None. No env, schema, migration, or endpoint-shape change — authorization wiring
only. Frontend and backend can deploy independently (each carries its own copy of
the constant; the sets are asserted equal by the test).

## 6. How to test

`backend/scripts/test-staff-gate-consistency.ts` — **27/27 PASS** (run from
`backend/`: `npx ts-node scripts/test-staff-gate-consistency.ts`). Drives the
real `StaffRolesGuard`:

- **CLIENT_CONSULTANT** (primary, no secondary) → **admitted** (the fix).
- **Aydin** (`CLIENT_CONSULTANT` + `[CLIENT_CONSULTANT, SUPPORT]`) → **admitted**.
- Every existing staff role (LIA, CONSULTANT, SUPPORT, FINANCE, OWNER, ADMIN,
  SUPER_ADMIN) → **admitted** (unchanged).
- **LEAD** and **STUDENT** (incl. with a non-staff secondary) → **denied**.
- Non-staff **primary** + staff **secondary** (LEAD+SUPPORT, STUDENT+CLIENT_CONSULTANT)
  → **admitted** (the intended widening, matches the middleware).
- **OPERATIONS** → **denied** on `/staff` (routes to `/ops`).
- Deactivated staff (`StaffActiveStatus.isActive=false`) → **denied** (active
  check intact).
- **Consistency:** backend `STAFF_PORTAL_ROLES` == the frontend constant by
  content; middleware + layout both import the shared constant and use `hasRole`;
  the guard widens via `hasRole` (no primary-only `includes`).

`nest build` clean; frontend `tsc --noEmit` clean.

**Post-deploy (prod):** minted a token for Aydin's user id and hit
`GET /api/staff/me` — now returns **200** with her payload
(`role: CLIENT_CONSULTANT`, `fullName: "Aydin Tashvighi"`, presigned `photoUrl`)
instead of 403.

## 7. Known limitations / deliberate exclusions

- **`OPERATIONS` is not admitted to `/staff`** (unchanged) — they use `/ops`.
- **Pre-existing OPERATIONS asymmetry left as-is:** `OPERATIONS` can read all
  cases + upload their own photo (those routes list it) but is not in the
  portal-shell/HR/leave set. That predates this PR and is out of scope; this PR
  only closes the `CLIENT_CONSULTANT` gap and unifies the widening rule.
- **Two constants, not one file** — the frontend (`lib/roles.ts`) and backend
  (`staff-roles.decorator.ts`) copies are separate because they run in separate
  processes/builds and can't share a module (same reason `hasRole` is mirrored).
  The runtime test asserts the two arrays hold identical role sets, so drift is
  caught, not silent.
- **Widening is a LOOSENING**, applied deliberately and bounded: it only admits
  users who already hold a *staff* role as primary or secondary. A user with no
  staff role (LEAD/STUDENT, empty or non-staff secondaries) matches nothing and
  is denied at all three gates — proven by the test.

## 8. How to extend

- **Add/remove a `/staff` portal role:** edit `STAFF_PORTAL_ROLES` in **both**
  `backend/src/staff/roles/staff-roles.decorator.ts` and
  `frontend/src/lib/roles.ts` (the test fails if they diverge). All three gates
  and the 10 routes pick it up automatically.
- **Add a new "any staff-portal user" route:** decorate it with
  `@StaffRoles(...STAFF_PORTAL_ROLES)` — never re-type the literal.

## 9. Security

- **Server-side enforcement unchanged in strength.** The `StaffRolesGuard` is
  still the boundary; it now *widens* with secondary roles (matching the platform
  `hasRole` convention already used by `RolesGuard` and the middleware) but never
  narrows. A non-staff user (LEAD/STUDENT) is denied at every gate — proven.
- **The active-status check is untouched** — a deactivated staff account is still
  blocked even when its role is allowed.
- **The loosening is bounded to legitimate staff:** admission requires a staff
  role in the primary OR secondary slot; there is no path for a role outside
  `STAFF_PORTAL_ROLES` to enter.
- **Identity still comes from the verified JWT / DB** — `StaffRolesGuard` reads
  `req.user` (populated by `JwtAuthGuard`, whose `JwtStrategy` re-reads role +
  secondaryRoles from the DB), never from the request body.

## 10. Rollback procedure

- **Code-only, no data/schema.** Revert the commit — the three gates return to
  their prior (divergent) literals. Frontend and backend can be rolled back
  independently; each side's constant is self-contained.
- No migration to reverse, no cache to clear. A rollback simply re-introduces the
  `CLIENT_CONSULTANT` lockout; nothing else is affected.
