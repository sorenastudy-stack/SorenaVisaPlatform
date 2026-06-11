# PHASE 2 — GOOGLE AUTHENTICATION + STAFF/CLIENT ROLES

**Status:** Part 1 complete and live in production (Google login working).
**Part 2 (magic-link email login) not yet built** — see Known Limitations.
**Last updated:** 2026-06-11 (auth hardening: /auth/register locked, Google secret rotated)

> Note for future developers: the placeholders in the source template have been
> resolved against the live codebase. Where the template's assumed wording
> didn't match the actual stack (e.g. the project uses Railway-hosted Postgres
> via Prisma, **not Supabase**), I've corrected the wording inline rather than
> invent a Supabase reference.

---

## 1. What this phase does (plain English)

This phase lets staff log into the Sorena Visa platform securely using their
Google account — no passwords to manage. When a user clicks "Continue with
Google" and signs in, the backend confirms who they are, checks they are an
allowed user, and issues a signed login token (a JWT). The frontend uses that
token to keep them logged in and to show them the staff portal. The first and
only admin so far is `yashoue@gmail.com`, set as SUPER_ADMIN. A second login
method (email magic link) is planned but not yet built.

---

## 2. Files created or changed

> The codebase is split across two deployments: a **frontend** (Next.js 14
> App Router on Vercel) and a **backend** (NestJS on Railway). Paths below are
> from the repo root.

**Frontend (Next.js / Vercel) — `frontend/src/...`:**
- `app/login/page.tsx` — the login screen with the **Continue with Google** button (top of card) and the email + password form (fallback). Reads `?error=not_authorized` and renders the amber "not on the invite list" banner.
- `app/auth/callback/page.tsx` — client landing page Google redirects back to. Parses `window.location.hash` for `token` + `role`, POSTs token to `/api/auth/google-session`, wipes the URL fragment, then redirects via `routeForRole(role)` from `lib/role-redirect.ts`.
- `app/staff/page.tsx` — the staff portal landing page.
- `app/staff/layout.tsx` — **first guard** for `/staff/*` (server component). Calls `getSession()` from `@/lib/auth`; if null redirects to `/login?next=/staff`; if role isn't in `STAFF_ROLES` redirects to `/unauthorized`.
- `lib/auth.ts` — exports `getSession()` (the server-side helper that reads the `sorena_session` cookie and verifies the JWT signature with `process.env.JWT_SECRET` using `jose.jwtVerify`) and the constant `COOKIE_NAME = 'sorena_session'`.
- `middleware.ts` — **second guard** that runs on every protected route (`/staff`, `/admin`, `/ops`, `/sales`, `/lia`, `/student`). Verifies the cookie's JWT with `jose.jwtVerify` and checks the role against the route-→-roles map. Two guard layers exist (middleware + per-layout `getSession()`) because middleware can't access certain runtime APIs and the layout adds an explicit role check.
- `app/api/auth/login/route.ts` — Route Handler that proxies email/password POSTs to the backend's `/auth/login` and sets the httpOnly `sorena_session` cookie.
- `app/api/auth/google-session/route.ts` — **new this phase.** Accepts `POST { token }` from `/auth/callback`, sets the same httpOnly `sorena_session` cookie with byte-identical attributes to the password-login route.
- `app/api/auth/logout/route.ts` — clears the cookie on POST (called by the sign-out button).
- `lib/role-redirect.ts` — **new this phase.** Single source of truth for the post-login role-→-route mapping; used by both `login/page.tsx` and `auth/callback/page.tsx`.
- `components/staff/shell/StaffTopBar.tsx` — contains the **Sign out** button (`handleSignOut` POSTs to `/api/auth/logout`).

**Backend (NestJS / Railway) — `backend/src/...`:**
- `auth/auth.controller.ts` — HTTP endpoints. `POST /auth/register`, `POST /auth/login` (existing), **`GET /auth/google`** and **`GET /auth/google/callback`** (new this phase). The callback mints a JWT via `JwtService.sign({ sub, email, role })` and 302-redirects to `${FRONTEND_URL}/auth/callback#token=<JWT>&role=<ROLE>` (URL fragment so the token never appears in server access logs).
- `auth/auth.service.ts` — `register()` (open; first-user bootstrap chooses role, subsequent registers default to `SALES`), `login()` (bcrypt-compare; **null-guards `passwordHash` for Google-only users with a clean 401**). The JWT is signed here via `JwtService.sign({ sub, email, role })`.
- `auth/auth.module.ts` — wires `JwtModule.register({ secret: process.env.JWT_SECRET || 'fallback_secret', signOptions: { expiresIn: '24h' } })`. *(Hardening: the `'fallback_secret'` literal should be removed; see §7.)*
- `auth/jwt.strategy.ts` — passport-jwt strategy. **Backend's JWT verifier** — verifies the `Authorization: Bearer` token on every protected backend endpoint.
- `auth/google.strategy.ts` — **new this phase.** passport-google-oauth20 strategy. `verifyGoogleProfile()` enforces invite-only: looks up the User by email (case-insensitive), rejects unknown / inactive / googleId-mismatch, and links the `googleId` on first successful match.
- `auth/google-auth.guard.ts` — **new this phase.** Subclasses `AuthGuard('google')`; on rejection 302-redirects to `${FRONTEND_URL}/login?error=not_authorized` instead of returning JSON 401.
- `auth/google.strategy.spec.ts` — **new this phase.** 8 tests covering the invite-only branches.
- `auth/auth.service.spec.ts` — **new this phase.** 2 tests including the null-passwordHash 401 branch.

**Config (not code, but changed this phase):**
- Vercel env var `JWT_SECRET` added (the fix that completed this phase). Must equal Railway's `JWT_SECRET` byte-for-byte.

---

## 3. Database tables / columns added

> **Stack correction:** the database is **PostgreSQL hosted on Railway, managed
> via Prisma** (not Supabase). Schema lives in `backend/prisma/schema.prisma`;
> migrations under `backend/prisma/migrations/`.

The `users` table (Prisma model `User`, `@@map("users")`) was created in Phase 1
and reconciled to the schema during this phase (60 missing migrations were
healed via `20260611220000_reconcile_railway_schema_drift`). Full columns
authentication relies on:

| Column | Purpose |
|---|---|
| `id` | Unique user ID (cuid, primary key) |
| `name` | Display name |
| `email` | User's email (unique) — used to identify the account |
| `emailHash` | HMAC-SHA256(email, EMAIL_HASH_SECRET) — for deterministic lookup of encrypted records (PII feature) |
| `passwordHash` | bcrypt-10 hash. **Nullable** since this phase — Google-only users have no password |
| `googleId` | **Added this phase.** Google `sub` claim, unique. Null until the user links Google. |
| `role` | `UserRole` enum — confirmed value in production: `SUPER_ADMIN` |
| `canEditGlobalData` | Boolean flag for cross-tenant edit privileges |
| `isActive` | If false, `google.strategy.ts` rejects sign-in even for invited emails |
| `lastLoginAt` | Set by `GoogleStrategy.verifyGoogleProfile()` on successful Google sign-in (existing password flow does not yet stamp this) |
| `createdAt` / `updatedAt` | Standard timestamps |

Plus PR-CONSULT-4 staff-profile columns (`mobileNumber`, `countryOfResidence`,
`address`, `emergencyContact`) and the PR-LIA-2 `specialisedCountries`
text-array — all reconciled this phase.

**New table this phase: `magic_link_tokens`** (Prisma model `MagicLinkToken`,
`@@map("magic_link_tokens")`). Schema landed and migrated, but no service code
uses it yet — that's Phase 2 Part 2 (magic-link login).

| Column | Purpose |
|---|---|
| `id` | cuid PK |
| `userId` | FK to `users.id`, ON DELETE CASCADE |
| `tokenHash` | Server-side hash of the link token; raw token is never stored |
| `expiresAt` | TTL |
| `consumedAt` | Set when used; null = unused (one-time-use enforcement) |
| `createdAt` | timestamps |

---

## 4. Environment variables added

Names only — **never commit values.**

**Vercel (frontend) — `sorena-visa-platform-aawd`:**
- `JWT_SECRET` — **added this phase.** Must be the **exact same value** as the backend's `JWT_SECRET`, or `lib/auth.ts:getSession()` cannot verify login tokens and every protected route bounces back to `/login`.
- `NEXT_PUBLIC_API_URL` — existed before this phase.
- `NEXT_PUBLIC_BACKEND_URL` — existed before this phase. Used by the **Continue with Google** button to navigate the browser to `${NEXT_PUBLIC_BACKEND_URL}/auth/google`.

**Railway (backend):**
- `JWT_SECRET` — the source-of-truth value. Copy this exact value into Vercel.
- `GOOGLE_CLIENT_ID` — added this phase. Read by `google.strategy.ts` constructor.
- `GOOGLE_CLIENT_SECRET` — added this phase. Read by `google.strategy.ts` constructor.
- `GOOGLE_CALLBACK_URL` — added this phase. Must equal what's registered in Google Cloud Console → Credentials → "Authorized redirect URIs". Production value: `https://sorenavisaplatform-production.up.railway.app/auth/google/callback`.
- `FRONTEND_URL` — added this phase. Where `auth.controller.ts:googleCallback()` redirects to after minting the JWT. Production value: `https://sorena-visa-platform-aawd.vercel.app`.

---

## 5. Third-party services connected

- **Google Cloud (OAuth)** — provides "Continue with Google". Manage at
  https://console.cloud.google.com → APIs & Services → Credentials.
  OAuth Client ID: `552670903027-9u1squlsh33cbgqbi8eu5jtvceel8qdd.apps.googleusercontent.com`
- **Vercel** — hosts the frontend. Project `sorena-visa-platform-aawd`.
  Live: https://sorena-visa-platform-aawd.vercel.app
- **Railway** — hosts the backend AND the PostgreSQL database. Backend live:
  https://sorenavisaplatform-production.up.railway.app
- **Postgres on Railway** — same Railway project, separate service. Users /
  roles / magic-link tokens / all schema lives here, managed via Prisma. No
  Supabase is connected to this project.

---

## 6. How to test it works

1. Open a fresh **incognito/private** browser window.
2. Go to `https://sorena-visa-platform-aawd.vercel.app/login`.
3. Click **Continue with Google**.
4. Choose `yashoue@gmail.com`.
5. **Expected:** brief "Signing you in…" on `/auth/callback`, then you land on
   `/staff` showing the staff portal sidebar (Overview / Cases / Meetings) and
   a placeholder "Coming soon" panel. You are **not** bounced back to `/login`.
6. DevTools → Application → Cookies → confirm `sorena_session` is present,
   HttpOnly + Secure + SameSite=Lax + Path=/.
7. Click **Sign out** in the top bar (`StaffTopBar.tsx`) → you return to the
   login screen and cannot reach `/staff` again without logging in.

If step 5 bounces you back to `/login?next=%2Fstaff`: the cause is `JWT_SECRET`
mismatch between Vercel and Railway (this was the exact bug that completed this
phase). Live-verified by minting a backend-signed JWT, POSTing it to
`/api/auth/google-session` (Set-Cookie returned correctly), then GETing
`/staff` with that cookie — `307 → /login?next=%2Fstaff` proves Vercel's
secret doesn't match Railway's. Fix = align the env var values + redeploy
Vercel.

---

## 7. Known limitations

- **Magic-link email login is NOT built yet.** This is "Option C part 2."
  The schema is ready (`magic_link_tokens` table exists), but no service code
  reads/writes it. Building it requires:
  (a) `RESEND_API_KEY` set on Railway (currently configured if MailService is
  enabled — `backend/src/mail/mail.service.ts` reads it),
  (b) a backend request endpoint that mints a token, hashes it into
  `magic_link_tokens`, and emails the click-through link via the existing
  `MailService`,
  (c) a verify endpoint that consumes the token (one-time-use enforced via the
  `consumedAt` column) and issues the same JWT the Google flow issues, and
  (d) an "Email me a sign-in link" form on `app/login/page.tsx`.
- **`'fallback_secret'` JWT fallbacks still in code** — both `auth.module.ts:14`
  and `frontend/src/lib/auth.ts:20` default to the literal `'fallback_secret'`
  if `JWT_SECRET` is unset. If either deployment ever loses the env var, tokens
  would be signable by anyone. Remove these fallbacks once both Vercel and
  Railway are confirmed to permanently have the value.
- **Only one role (`SUPER_ADMIN`) is actually in use in production.** The
  staff/client split is defined in code (the `UserRole` enum + the
  middleware's role-to-route map) but not yet exercised with real client
  accounts.
- **Auto-logout / inactivity timeout — NOT IMPLEMENTED.** The session cookie's
  `maxAge` is 7 days (`60 * 60 * 24 * 7`). There is no 30-minute or any
  inactivity-based expiry. If that's a launch requirement, it has to be built.

---

## 8. How a future developer would extend this

- **Add the magic-link login:** the `magic_link_tokens` table is already there.
  Build a backend module (e.g. `backend/src/auth/magic-link/`) with a request
  endpoint (`POST /auth/magic-link/request`) that finds the User by email,
  mints a random token, stores `tokenHash` + `expiresAt`, and sends the link
  via `MailService.send()` (Resend is already wired). Build a verify endpoint
  (`GET /auth/magic-link/consume?token=...`) that hash-compares, marks
  `consumedAt`, issues the same JWT via `jwtService.sign({sub,email,role})` as
  the Google flow, and 302-redirects to `${FRONTEND_URL}/auth/callback#token=...&role=...`.
  Re-use `frontend/src/app/auth/callback/page.tsx` — same fragment contract,
  same cookie write.
- **Add new roles** (e.g. CLIENT, AGENT): extend the `UserRole` enum in
  `backend/prisma/schema.prisma`, run a migration to add the enum value, add
  the role string to `frontend/src/middleware.ts`'s `ROLE_ROUTES` map, add it
  to `frontend/src/app/staff/layout.tsx`'s `STAFF_ROLES` set if staff-side,
  and add a routing rule to `frontend/src/lib/role-redirect.ts`.
- **Add more allowed users:** insert their row in `users` via the open
  `POST /auth/register` (for now), or via SQL once registration is locked
  down, or via a future OWNER-only admin invite flow.
- **Protect a new server-rendered page:** copy the pattern from
  `frontend/src/app/staff/layout.tsx`:
  ```ts
  const session = await getSession();
  if (!session) redirect('/login?next=/your-route');
  if (!ALLOWED_ROLES.has(session.role)) redirect('/unauthorized');
  ```
  `getSession()` is in `frontend/src/lib/auth.ts`. Also add the route prefix to
  `frontend/src/middleware.ts`'s `ROLE_ROUTES` for the first-line check.

---

## 9. Security layers applied (from the project's 10-layer standard)

This phase touches authentication and personal identity, so:

- **Layer 1 — Google OAuth for staff/clients:** ✅ implemented. Primary login
  is Google (passport-google-oauth20); invite-only via
  `GoogleStrategy.verifyGoogleProfile()` — unknown emails are rejected, never
  provisioned. Email/password still works as a fallback.
- **Layer 3 — All secrets in environment variables:** ✅ `JWT_SECRET`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` live in Vercel/Railway env vars,
  not in code or GitHub.
  **Hardening still needed:** remove `'fallback_secret'` defaults from
  `backend/src/auth/auth.module.ts:14` and `frontend/src/lib/auth.ts:20`.
- **Layer 4 — HTTPS only:** ✅ Vercel and Railway both serve HTTPS by default;
  the auth cookie carries `Secure` in production (`NODE_ENV === 'production'`).
- **Layer 8 — Auto-logout after inactivity:** ❌ **NOT IMPLEMENTED.** Cookie
  `maxAge` is 7 days fixed; no idle / inactivity timeout. Outstanding.

Layers still to apply or verify for auth:
- **Layer 2 — Row-Level Security:** N/A as written — the schema uses Postgres
  via Prisma with application-level role checks (jwt.strategy.ts + per-layout
  `getSession()` + middleware). There is no Supabase RLS. If row-isolation is
  required (e.g. an LIA can only see cases they own), that's enforced at the
  ORM-query layer (Prisma `where` clauses), and is a Phase-other concern.
- **Layer 5 — Rate limiting on auth endpoints:** ⚠️ partially applied.
  `app.module.ts` registers `ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])`
  — a global 60-req-per-minute-per-IP cap. There is **no auth-specific tighter
  limit** on `/auth/login` or the future magic-link request endpoint.
  Recommend adding `@Throttle({ default: { ttl: 60000, limit: 5 } })` on these.
  **`/auth/register` itself is now locked down** (2026-06-11, commit `2e60ad5`):
  it requires a valid JWT (`JwtAuthGuard`) **and** a role of `OWNER` or
  `SUPER_ADMIN` (`RolesGuard` + `@Roles('OWNER', 'SUPER_ADMIN')`). Anonymous
  calls return **401 Unauthorized**; non-admin authenticated roles return
  **403 Forbidden**. Verified in production via an anonymous POST returning
  `401`. Tighter auth-specific rate-limiting on the other endpoints remains
  outstanding.
- **Layer 6 — Audit log of admin actions:** ⚠️ `AuditLog` model exists in
  `backend/prisma/schema.prisma`, but **no login or auth event currently writes
  to it** (grep of `backend/src/auth/` for `AuditLog` returns zero matches).
  Logins, role changes, and registrations should write rows here.

### Secret rotation (2026-06-11)

The Google OAuth client secret that was previously exposed in screenshots/chat
has been rotated. A new secret was generated in Google Cloud, set in Railway's
`GOOGLE_CLIENT_SECRET`, deployed, and verified by a successful production login.
The old leaked secret has been disabled in Google Cloud (status: **Disabled**)
so it can no longer authenticate; it can be fully deleted later. Layer 3
(secrets in env vars) reaffirmed.

---

## 10. Rollback instructions

This phase's completing change was adding `JWT_SECRET` to Vercel and
redeploying. To roll back:

1. **Fast rollback (recommended):** Vercel → Deployments → pick the previous
   working deployment → ⋯ menu → **Promote to Production** (or **Rollback**).
   This reverts the frontend without deleting anything.
2. **Undo the env var:** Vercel → Settings → Environment Variables → delete
   `JWT_SECRET` → redeploy. Note: doing this will RE-BREAK login (users bounce
   back to `/login` for the exact reason this phase fixed), so only do it if
   intentionally reverting the whole phase.
3. **Backend:** Railway keeps deploy history — Railway → Deployments → select a
   prior deployment → redeploy/rollback if a backend change must be undone.
4. **Database:** no rollback required for this phase. The
   `option_c_passwordless_auth_prep` migration is additive
   (`passwordHash` → nullable, `googleId` added, `magic_link_tokens` created)
   and `reconcile_railway_schema_drift` is purely additive + idempotent.
   Keeping these is safer than reverting.

---

*End of Phase 2 handover.*
