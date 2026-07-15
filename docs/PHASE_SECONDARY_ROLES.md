# PR-SECONDARY-ROLES — Secondary staff roles (widen access only)

Staff users get an optional set of **secondary roles** that WIDEN their access.
They never change the primary `role`, never narrow access, never change where a
user lands after login, and never change the UI badge.

## 1. What this PR does

- Adds `User.secondaryRoles UserRole[] @default([])` — additive, empty for every
  existing user.
- Widens the **two systematic permission gates** to accept the primary `role`
  OR any secondary role:
  - Backend `RolesGuard` (covers every `@Roles(...)`-protected endpoint).
  - Frontend `middleware.ts` (covers every gated route in `ROLE_ROUTES`).
- Carries `secondaryRoles` in the JWT payload (so the frontend can widen) and
  re-reads them from the DB in `JwtStrategy` on every request (so the backend
  reflects grants immediately).
- Adds an OWNER-only endpoint + UI to set a staff user's secondary roles, fully
  audited.
- **Unchanged on purpose:** `role` (login, `routeForRole`, `StaffRoleBadge`),
  the `StaffRolesGuard` used for staff-user *management* (see §7/§9), and all
  domain-logic role reads (signer roles, LIA booking eligibility, promotion,
  finer-grained in-endpoint doc authz).

## 2. Files changed

**Backend**
- `prisma/schema.prisma` — `User.secondaryRoles` field.
- `prisma/migrations/20260715130000_user_secondary_roles/migration.sql` — new.
- `src/auth/role.util.ts` — **new** shared `hasRole(user, ...allowed)` helper.
- `src/auth/guards/roles.guard.ts` — widened via `hasRole`.
- `src/auth/jwt.strategy.ts` — select + return `secondaryRoles`.
- `src/auth/auth.service.ts`, `auth.controller.ts`, `google.strategy.ts`,
  `magic-link.service.ts`, `password-setup.service.ts` — carry `secondaryRoles`
  in the JWT payload.
- `src/staff/users/staff-users.service.ts` — `setSecondaryRoles()` + expose
  `secondaryRoles` in `detail()`.
- `src/staff/users/staff-users.controller.ts` — `PATCH :id/secondary-roles`.
- `src/staff/users/dto/staff-users.dto.ts` — `SetSecondaryRolesDto`.

**Frontend**
- `src/lib/roles.ts` — **new** parallel `hasRole` helper.
- `src/lib/auth.ts` — `Session.secondaryRoles` + read from payload.
- `src/middleware.ts` — widened via `hasRole`.
- `src/components/staff/users/SecondaryRolesSection.tsx` — **new** OWNER-only UI.
- `src/components/staff/users/StaffDetailOverlay.tsx` — render the section.
- `src/components/staff/users/types.ts` — `StaffUserDetail.secondaryRoles`.

## 3. Schema added

```prisma
model User {
  role           UserRole   @default(SALES)
  secondaryRoles UserRole[] @default([])   // WIDEN only; never touches `role`
}
```

Migration (additive, idempotent — `UserRole` already exists, so no `CREATE TYPE`):
```sql
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "secondaryRoles" "UserRole"[] NOT NULL DEFAULT ARRAY[]::"UserRole"[];
```
NOT NULL + constant default ⇒ PG 11+ applies it as a fast metadata-only change
(no rewrite); every existing row gets `{}`.

## 4. Endpoint contract

### Route
`PATCH /api/staff/users/:id/secondary-roles` — **OWNER only**.

### Guards
`JwtAuthGuard` → `StaffRolesGuard` + `@StaffRoles('OWNER')` (checks the **primary**
role — a secondary OWNER cannot reach this grant surface) + `UpdateProfileRateLimitGuard`.

### Body
```json
{ "secondaryRoles": ["SUPPORT", "FINANCE"], "reason": "optional" }
```
`secondaryRoles` is validated against the full `UserRole` enum (anything else → 400).

### Response
```json
{ "userId": "…", "secondaryRoles": ["SUPPORT", "FINANCE"] }
```

### Server-side rules
- Rejects `targetId === actorId` (**no self-grant**) → 403.
- Whitelists to valid `UserRole` values, dedupes, and **strips the target's
  primary role** (a role is primary xor secondary).
- Writes an audit row (`action`/`eventType = CHANGE_STAFF_SECONDARY_ROLES`,
  `entityType=User`, `entityId`, `oldValue`, `newValue`, actor snapshots).

## 5. Configuration

None. No new env vars. The JWT payload gained `secondaryRoles`; the backend
signs it and the frontend verifies it — both already share `JWT_SECRET`.

## 6. How to test (manual)

1. As OWNER, open `/staff/users`, click a **CONSULTANT**, tick **SUPPORT** in the
   "Secondary roles" section, Save.
2. Sign in as that user → they still land on the CONSULTANT destination, and the
   badge still says CONSULTANT (routing/display use the primary role).
3. They can now reach SUPPORT-gated endpoints/routes (guard/middleware widen).
4. As a non-OWNER, `PATCH …/secondary-roles` → **403**.

Automated proof: `scripts/test-secondary-roles.ts` (local-only, gitignored) —
13/13 checks: hasRole widen, persist, **primary unchanged**, effective SUPPORT
access, audit before/after, whitelist, self-grant block, non-OWNER 403.

## 7. Known limitations

- Secondary roles widen the **systematic** gates only (`RolesGuard` +
  frontend middleware). Finer-grained in-endpoint authz (e.g. `documents`
  `ADMIN_TIER.has(actor.role)`, CONSULTANT doc restrictions) still reads the
  **primary** role and is intentionally not widened here (several are narrowing
  or domain-specific; widening them needs a deliberate per-check decision).
- The staff-user **management** gate (`StaffRolesGuard`) is **not** widened — it
  is the privilege-*granting* surface, so `@StaffRoles('OWNER'/'SUPER_ADMIN')`
  requires the primary role. This blocks any secondary-role escalation path.
- The UI multi-select offers `ASSIGNABLE_ROLES` (excludes STUDENT/OWNER); the
  backend still accepts any valid `UserRole` but strips the primary.

## 8. How to extend

- To widen a specific in-endpoint check, replace `allowed.includes(actor.role)`
  (or `SET.has(actor.role)`) with `hasRole(actor, ...allowed)` — `req.user`
  already carries `secondaryRoles` from `JwtStrategy`.
- To add a role to the picker, edit `ASSIGNABLE_ROLES`.

## 9. Security layers applied

- **OWNER-only, verified server-side** from the session role (not the UI), via
  `@StaffRoles('OWNER')` on the primary-role `StaffRolesGuard`.
- **No self-grant** — `targetId === actorId` rejected.
- **No escalation path** — the grant surface never honours secondary roles.
- **Input validation** — DTO `@IsEnum(UserRole, { each: true })` + a service
  whitelist that also strips the primary role.
- **Audit** — every change logs who/target/before/after/when.
- **Rate-limited** — `UpdateProfileRateLimitGuard`.

## 10. Rollback procedure

- **Code:** revert the commit. The gates fall back to `allowed.includes(role)`;
  with `secondaryRoles` empty for everyone, behaviour is identical to before.
- **Schema:** the column is additive and nullable-by-default; leaving it is
  harmless. To fully roll back: `ALTER TABLE "users" DROP COLUMN IF EXISTS
  "secondaryRoles";` (no other table references it).
- **Order:** the code selects `secondaryRoles`, so apply the migration **before**
  deploying the code, and drop the column only **after** reverting the code.
