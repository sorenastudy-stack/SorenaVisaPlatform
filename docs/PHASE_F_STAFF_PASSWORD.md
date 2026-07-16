# PR-STAFF-PASSWORD — staff self-service password reset + change

Staff can now manage their own passwords: a **"Forgot password?"** flow on the
staff sign-in (reset link → set new password → signed in), and a
**change-password** page for a signed-in staff member (current password
required). Reuses the proven token pattern; no parallel token *system*.

## 1. What this PR does

- **Forgot password:** "Forgot password?" on `/login` → `/forgot-password`
  (enter email) → emailed reset link → `/reset-password` (set new password) →
  signed in and routed via `routeForRole`.
- **Change password:** `/staff/account` — a signed-in staff member sets a new
  password, gated on their **current** password.
- Both credential endpoints are rate-limited, audited, and enforce the existing
  password strength rule. Anti-enumeration matches the existing magic-link shape.

## 2. Files changed

**Backend**
- `prisma/schema.prisma` + `migrations/20260716120000_password_reset_tokens/` —
  new `PasswordResetToken` table (distinct from the LEAD-only setup token).
- `src/auth/password-reset.service.ts` — **new** (request / validate / reset).
- `src/auth/auth.service.ts` — **new** `changePassword(userId, current, new, ip)`.
- `src/auth/dto/reset-password.dto.ts` — **new** `ResetPasswordDto` +
  `ChangePasswordDto`.
- `src/auth/auth.controller.ts` — 4 endpoints.
- `src/auth/auth.module.ts` — register `PasswordResetService`.
- `src/mail/mail.service.ts` + `mail.templates.ts` — `sendPasswordResetLink`.

**Frontend**
- `app/login/page.tsx` — "Forgot password?" link.
- `app/forgot-password/page.tsx` — **new**.
- `app/reset-password/page.tsx` — **new** (mirrors `/set-password`).
- `app/api/auth/reset-password/route.ts` — **new** (sets the session cookie).
- `app/staff/account/page.tsx` — **new** (change password).
- `components/staff/shell/StaffSidebar.tsx` — "Account" nav (general + finance).

**Test (local-only, gitignored):** `scripts/test-staff-password.ts`.

## 3. Schema added

```prisma
model PasswordResetToken {
  id String @id @default(cuid())
  userId String
  email String        // captured at issue; verified before consume
  tokenHash String     // sha256(raw) — raw never stored
  expiresAt DateTime
  consumedAt DateTime? // single-use
  createdAt DateTime @default(now())
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([tokenHash]) @@index([tokenHash]) @@index([userId])
  @@map("password_reset_tokens")
}
```
**Why a separate table** (not the setup token): a reset overwrites an existing
password on ANY role — the exact opposite of the setup token's LEAD-only /
passwordless invariant. Separation guarantees a setup token can never reach the
reset path and vice-versa. Additive `CREATE TABLE`; applied to prod by
`prisma migrate deploy` on deploy.

## 4. Endpoint contract

| Endpoint | Guard / throttle | Body → returns |
|---|---|---|
| `POST /auth/password-reset/request` | 5/min/IP, HttpCode 200 | `{email}` → generic 200 (anti-enumeration) |
| `GET /auth/password-reset/validate` | 20/min/IP | `?token&email` → `{valid:true}` (read-only) |
| `POST /auth/password-reset` | 5/min/IP | `ResetPasswordDto` → `{token, role}` |
| `POST /auth/change-password` | JwtAuthGuard + 5/min/IP | `ChangePasswordDto` → `{ok:true}` |

`/reset-password` completion goes through the same-origin `/api/auth/reset-password`
Next route, which sets the httpOnly `sorena_session` cookie (JWT never touches the
browser). Reset token TTL **30 min**, single-use.

## 5. Configuration

None new. Emails send via Resend from `EMAIL_FROM` (the SPF fix —
`include:amazonses.com` on the root record — now lands `@sorenavisa.com` mail).
Strength rule reused verbatim: **≥10 chars, ≥1 letter, ≥1 number**.

## 6. How to test

`scripts/test-staff-password.ts` — **14/14**: forgot→reset→signed-in with correct
role; single-use replay rejected; expired rejected; unknown email silent/identical
(no enumeration); change with wrong current rejected; change with correct current
succeeds + old fails; `ChangePasswordDto` has no `userId`; `@Throttle` on all four
endpoints; audit rows for all three events. `tsc` clean (backend src + frontend 0).

## 7. Known limitations

- **Session invalidation is NOT supported** and is not faked. The session is a
  stateless 7-day JWT cookie; there is no `tokenVersion`/`passwordChangedAt` on
  `User` and `JwtStrategy` doesn't check one. After a reset/change the old
  password stops working, but existing JWT cookies stay valid until expiry.
  Supporting it would require adding `passwordChangedAt` to `User` + a
  `JwtStrategy` `iat < passwordChangedAt` reject — a global auth change, flagged
  for a follow-up rather than snuck in here.
- Reset does invalidate any *other outstanding reset tokens* for the user.

## 8. How to extend

- To enforce session invalidation: add `User.passwordChangedAt`, set it in
  `resetPassword` + `changePassword`, and reject JWTs with `iat` older than it in
  `JwtStrategy.validate`.
- Google-only accounts (no `passwordHash`) can't change-password (nothing to
  verify) — they're directed to "Forgot password" to create one.

## 9. Security layers applied

- **Rate-limited** — every credential endpoint has a hard per-IP `@Throttle` on
  top of the global default.
- **Own password only** — `changePassword` takes `userId` from the JWT
  (`req.user.userId`); the DTO has no `userId`. Cannot target another user.
- **Current password mandatory** — verified with `bcrypt.compare` before writing;
  a hijacked session can't lock the owner out.
- **Anti-enumeration** — `password-reset/request` always returns a generic 200;
  the service is silent on unknown/inactive accounts.
- **Single-use, short-lived, hashed tokens** — sha256(raw) stored, 30-min TTL,
  race-safe `consumedAt` consume before the write; raw token only in the URL
  fragment (never sent to the server / logs).
- **Audited** — `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`,
  `PASSWORD_CHANGED` rows with actor name/role snapshot + IP.
- **Strength** — same rule as every other password entry point.

## 10. Rollback procedure

- **Code:** revert the commit. The endpoints, pages, and nav entry disappear
  together; existing login/setup/magic-link flows are untouched.
- **Schema:** drop is safe — `DROP TABLE IF EXISTS "password_reset_tokens";`
  (no other table references it). Leaving it is harmless.
- **Order:** deploy backend before frontend (the pages call the new endpoints);
  revert frontend first on rollback.
