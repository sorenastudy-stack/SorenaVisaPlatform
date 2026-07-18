# PHASE-M — Staff profile photos + licence-page preview

Two parts. (1) Staff profile photos on Cloudflare R2 — self-service on the
Account page, admin upload in HR, displayed everywhere a staff member is
identified, with an initial-circle fallback. (2) The LIA licence file is now
clickable to preview; the licence-number edit affordance is reported.

## 1. What this PR does

**Part 1 — photos**
- `User.photoKey` (nullable R2 object key; additive migration, no backfill).
- **R2** (the persistent, already-wired `documents` pattern — NOT the ephemeral
  local disk used by LIA-licence/HR-contract). `R2Service.putObject` added.
- **Self-upload** (`/staff/account`, own JWT only) and **admin upload**
  (`/staff/users/:id` HR section, `@AdminTier`, audited).
- `photoUrl` (short-lived presigned GET) threaded into `/api/staff/me`,
  `/api/staff/users` (list + detail), `/staff/team` (list + detail), and case
  detail **assignments**. Shared `<StaffAvatar>` renders photo-or-initials at:
  StaffTopBar (`/staff`), PortalLayout (`/lia,/ops,/sales,/admin`), the users
  list, team list + detail, and the case Assignments panel.

**Part 2 — licence page**
- The uploaded licence **filename is now clickable → preview** (opens the
  existing signed URL in a new tab) on `/staff/lia-profile` AND in the verifier
  overlay (`/staff/lia-verification`, which already had a working preview button).
- The licence **number** field is an always-editable input + Save (disabled
  until changed) — a clear edit affordance already; **left as-is** (see §7).

## 2. Storage decision (why R2, not the licence/HR disk pattern)

The LIA-licence and HR-contract uploads use multer **local disk** (`./uploads`),
which is **ephemeral on Railway** — files vanish on redeploy. Fine-ish for rarely
re-fetched documents, wrong for avatars shown on every page. The `documents`
module already uses **Cloudflare R2** (`R2Service`, presigned URLs) — persistent
object storage. Photos reuse that. The server receives the multipart bytes,
validates type+size on the **actual bytes**, and `putObject`s to R2 (a small
addition to `R2Service`, complementing its presigned client-direct upload).

## 3. Files changed

**Backend** — `prisma/schema.prisma` (+`photoKey`), migration
`20260718120000_user_photo_key`, `common/r2/r2.service.ts` (+`putObject`),
**new** `staff/photos/{service,controller,module}.ts`, `app.module.ts`
(register), and `photoUrl` wiring in `staff/me`, `staff/users`, `staff/team`,
`staff/cases` (service + module each).

**Frontend** — **new** `components/staff/StaffAvatar.tsx`; `StaffContext`
(+`photoUrl`); `StaffTopBar`, `PortalLayout`, `StaffUsersTable`(+types),
`StaffHrAdminSection` (admin upload) + `StaffDetailOverlay` (wire), team
`StaffListClient`/`StaffEditClient`, `CaseAssignmentsPanel`(+types); Account page
(self-upload); `LicencePageClient` + `VerifyOverlay` (Part 2).

**Test (local-only, gitignored):** `backend/scripts/test-staff-photos.ts`.

## 4. Endpoint contract

| Endpoint | Guard | Body → returns |
|---|---|---|
| `POST /api/staff/me/photo` | JWT + `@StaffRoles(all staff)`, 10/min | multipart `file` → `{ ok, photoUrl }` |
| `DELETE /api/staff/me/photo` | JWT + `@StaffRoles(all staff)`, 10/min | → `{ ok, photoUrl: null }` |
| `POST /api/staff/users/:id/photo` | `@AdminTier`, 20/min, **audited** | multipart `file` → `{ ok, photoUrl }` |
| `DELETE /api/staff/users/:id/photo` | `@AdminTier`, 20/min, **audited** | → `{ ok, photoUrl: null }` |

Self routes take the userId from the JWT (path is `me/photo`, no `:id`). Images
only (JPG/PNG/WebP), 5 MB, rejected at multer AND re-validated on the bytes.

## 5. Configuration

Requires the R2 env vars already used by the documents module (`R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`) — no new config. Photos
land under the `staff-photos/<userId>/` key prefix. Presigned GET TTL = 1h.

## 6. How to test

`scripts/test-staff-photos.ts` — **15/15, runtime** (real service, mock Prisma+R2):
- `presignedUrl` null-safe + 1h GET; self-upload puts bytes under
  `staff-photos/<userId>/`, stores the key, returns a `photoUrl`; **rejects**
  wrong-type / oversized / missing; accepts JPG+WebP; **admin upload writes an
  audit row** (target + actor) while self-upload writes none; delete clears the
  key + removes the object; **self routes gated to all-staff with no `:id`**,
  **admin routes `@AdminTier` on `users/:id/photo`**.
- `nest build` clean; frontend `tsc` + `next build` clean (account/users/
  lia-profile routes compiled). Prior security suites (PHASE-I/J/K/L) still green.

**Acceptance mapping:** staff self-upload on Account → StaffTopBar + `StaffAvatar`
in the users list/team (via `refresh()` + presigned `photoUrl`); admin upload in
HR → audited + list/overlay refresh; non-admin → **403** (`@AdminTier`); no photo
→ initial-circle (`StaffAvatar` fallback); oversized/wrong-type → rejected; the
licence preview opens the signed URL (5-min expiry unchanged).

## 7. Part 2 details (reported)

- **Licence preview:** the file row previously had only a "Download" button. Now
  the **filename is a clickable button** (opens the signed URL in a new tab —
  the browser previews the PDF/image inline); the action button is relabelled
  "Preview". The verifier overlay already opened the file via a button; its
  filename is now clickable too. The signed URL is the existing 5-minute
  `createSignedDownloadToken` — **unchanged**, still expires.
- **Licence-number edit:** it is an always-editable text field with a **Save**
  button that is **disabled until the value changes** (react-hook-form `isDirty`)
  and shows a "changing this clears verification" warning when verified. That is
  already a clear edit affordance, so per the brief it was **left unchanged** —
  no explicit edit/cancel toggle was added.

## 8. Known limitations / follow-ups

- **Presigned photo URLs expire (1h)** and are minted per identity response.
  Fine for page-session use; a very long-open tab would need a refresh (the
  shells already re-fetch `/api/staff/me`). A public/CDN photo URL could avoid
  presigning but the R2 bucket is private by design.
- **Not every staff-name site got an avatar** — the CasesTable/CasesGrid list
  columns, meetings/bookings rows, the leads assignee chip, and the reassign
  candidate list still show name-only. `<StaffAvatar>` is ready; each needs
  `photoUrl` added to its own list DTO. Deferred (not in the tested set).
- Local disk uploads (LIA licence, HR contract) remain ephemeral — a separate
  migration to R2 would fix that; out of scope here.

## 9. Security applied

- **Self = own JWT only** — `me/photo` routes take the userId from the token; no
  `:id`/userId param exists to attack.
- **Admin = role-gated + audited** — `users/:id/photo` is `@AdminTier`
  (OWNER/SUPER_ADMIN/ADMIN) server-side; a non-admin gets 403. Every admin
  upload/remove writes an `AuditLog` row (actor + target snapshot).
- **File hardening** — JPG/PNG/WebP whitelist + 5 MB cap enforced at multer AND
  re-validated on the actual bytes in the service; per-user key prefix; private
  R2 with short-lived presigned reads.
- **Rate-limited** — 10/min self, 20/min admin.
- **Fallback safe** — no photo (or a presign error) degrades to the initial
  circle, never a broken image.

## 10. Rollback procedure

- **Migration:** additive + nullable → `DROP COLUMN "users"."photoKey";` is a
  safe reverse; leaving the column is harmless.
- **Code:** revert the commit — the endpoints, `<StaffAvatar>`, and all wiring
  disappear together; `photoUrl` fields simply stop being returned; the shells
  fall back to initials. R2 objects already written are orphaned (harmless; a
  bucket lifecycle rule or manual prune clears `staff-photos/`).
- **Snapshot-first:** the migration applies via the pre-deploy `migrate deploy`
  on the next deploy — snapshot prod before that deploy (this PR pauses for it).
- **Order:** deploy backend before frontend (frontend reads `photoUrl`); on
  rollback, revert frontend first.
