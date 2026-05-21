# PR-CONSULT-4 — Staff profile fields, Edit, Archive, Hard delete + SALES cleanup

Handover for the staff-profile expansion and three-state lifecycle that lands on top of PR-CONSULT-3.

## 1. What this PR does

Staff users now carry four additional profile fields — `mobileNumber`, `countryOfResidence`, `address`, `emergencyContact` — captured at Create time and editable any time via a new **Edit profile** overlay. Three of those columns are encrypted at rest (AES-256-GCM via `CryptoService`, base64 envelope); `countryOfResidence` stays as plain ISO 3166-1 alpha-2 so it can be filtered / aggregated.

The deactivate/reactivate flow from PR-CONSULT-1 is now framed as **Archive** / **Restore** in the UI — same backend endpoints, friendlier labels and an "Archived on {date} by {actor}" line in the detail. A new **Hard delete** action permanently removes the user record: OWNER inline, SUPER_ADMIN routed through the existing owner-approval queue (new action type `HARD_DELETE_STAFF`). The delete flow snapshots the user's `name` + `role` into every audit row that references them before the row is removed, so historical attribution survives.

Two pieces of housekeeping ride along: every legacy `SALES` user is migrated to `CONSULTANT` + archived, and the four `sorenatest.com` test users are archived. The `SALES` enum value is **retained** because Postgres doesn't allow `DROP VALUE`; the DTO layer rejects new writes to it.

Country names + flag emoji come from the [`i18n-iso-countries`](https://www.npmjs.com/package/i18n-iso-countries) package (MIT, ~150KB, bundled `en` + `fa` locales). The frontend has a single shared `CountryPicker` for use anywhere in the app.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260521000000_pr_consult_4_staff_profile_and_lifecycle/migration.sql` — adds the four profile columns, the audit snapshot columns, the new `HARD_DELETE_STAFF` enum value, and the data migrations for SALES + test users.
- `src/common/country-codes.ts` — thin wrapper over `i18n-iso-countries` exposing `ALL_COUNTRY_CODES`, `isValidCountryCode`, `getCountryName`.
- `src/staff/users/guards/staff-users-rate-limit.guards.ts` — `UpdateProfileRateLimitGuard` (60/hr) + `HardDeleteRateLimitGuard` (10/hr).

Backend (existing):
- `prisma/schema.prisma` — `User` model gains the four nullable profile columns; `AuditLog` gains `actorNameSnapshot` + `actorRoleSnapshot`; `OwnerApprovalActionType` gains `HARD_DELETE_STAFF`.
- `src/common/audit/audit.helper.ts` — summariser handles `STAFF_PROFILE_UPDATED`, `STAFF_HARD_DELETED`, `STAFF_ROLE_NORMALIZED_FROM_SALES`.
- `src/staff/users/dto/staff-users.dto.ts` — `CreateStaffUserDto` extended; new `UpdateStaffProfileDto`; custom `IsCountryCode` validator wraps `isValidCountryCode`.
- `src/staff/users/staff-users.service.ts` — accepts `archived` filter on list; detail returns decrypted profile fields + archive metadata; new `updateProfile` method; `hardDeleteStaffAsOwner` delegates to `OwnerApprovalService.hardDeleteStaffDirect`.
- `src/staff/users/staff-users.controller.ts` — new `PATCH /:id` (edit profile) and `DELETE /:id` (hard delete); `GET /` accepts `?archived=`; `POST /` passes the new profile fields through.
- `src/staff/users/staff-users.module.ts` — imports `CryptoModule` (encryption envelope for the new columns).
- `src/staff/owner-approval/owner-approval.service.ts` — `createStaffUserDirect` now accepts + encrypts the profile fields; new `hardDeleteStaffDirect` does the full cleanup-and-delete dance; new `execHardDeleteStaff` executor; `ActionType` union and dispatcher both include `HARD_DELETE_STAFF`.
- `tsconfig.json` — added `resolveJsonModule` + `esModuleInterop` so `i18n-iso-countries`' bundled JSON locale files import cleanly.
- `package.json` (+ `package-lock.json`) — added `i18n-iso-countries@^7.14.0`.

Frontend (new under `src/`):
- `lib/country-codes.ts` — frontend mirror of the backend wrapper; registers both `en` and `fa` locales; exposes `countryCodeToFlagEmoji` and `getSearchableCountries`.
- `components/common/CountryPicker.tsx` — searchable dropdown with flag + name + code; RTL-aware via flexbox + `start-*`/`end-*` Tailwind utilities.
- `components/staff/users/EditStaffOverlay.tsx` — edit profile (name / email / mobile / country / address / emergency contact). Submits a diff.
- `components/staff/users/HardDeleteConfirmOverlay.tsx` — confirmation overlay requiring the user to type the target's full name (case-sensitive) before the red delete button enables.
- `components/staff/approvals/payload-renderers/HardDeleteStaffPayload.tsx` — payload preview that resolves the target user's name + email + role for the OWNER's decision context.

Frontend (existing):
- `components/staff/users/types.ts` — `StaffUserDetail` adds the four profile fields + archive metadata.
- `components/staff/users/CreateStaffOverlay.tsx` — adds Mobile / Country / Address / Emergency-contact inputs; uses the new CountryPicker.
- `components/staff/users/StaffDetailOverlay.tsx` — renders profile fields; adds Edit-profile + Hard-delete buttons; renames Deactivate → Archive, Reactivate → Restore in labels.
- `components/staff/users/StaffUsersTable.tsx` — archived rows render at 50% opacity.
- `components/staff/users/StaffUsersPageHeader.tsx` + `StaffUsersPageClient.tsx` + `useStaffUsersQuery.ts` — `Active only` toggle replaced by `Show archived`; query hook fires `?archived=…` server-side.
- `components/staff/approvals/types.ts` — `ApprovalActionType` union adds `HARD_DELETE_STAFF`.
- `components/staff/approvals/ApprovalPayloadPreview.tsx` — dispatches `HARD_DELETE_STAFF` to the new renderer.
- `i18n/messages/en.json` + `fa.json` — ~25 new keys under `staff.users.*` + `staff.approvals.actionType.HARD_DELETE_STAFF`.
- `package.json` (+ `package-lock.json`) — added `i18n-iso-countries@^7.14.0`.

## 3. Schema added

```prisma
model User {
  // ... existing columns ...
  mobileNumber        String?  // encrypted (CryptoService base64 envelope)
  countryOfResidence  String?  // ISO 3166-1 alpha-2, plain text
  address             String?  // encrypted
  emergencyContact    String?  // encrypted
}

model AuditLog {
  // ... existing columns ...
  actorNameSnapshot  String?
  actorRoleSnapshot  String?
}

enum OwnerApprovalActionType {
  // ... existing ...
  HARD_DELETE_STAFF
}
```

All new User columns are nullable so existing rows survive the migration; the DTO layer enforces `mobileNumber` + `countryOfResidence` as required at create. The audit snapshots stay null on rows written before this PR; the hard-delete service fills them in for the deleted actor's rows as part of its tear-down sequence.

## 4. The audit-log snapshot mechanism

**Why it exists.** Every audit row points to its actor via `userId`. When a User is hard-deleted, Postgres's default `SET NULL` cascade kicks in on the `AuditLog.userId` FK, so the audit rows survive but no longer attribute to a name. The new `actorNameSnapshot` + `actorRoleSnapshot` columns preserve attribution.

**What it protects.** A future compliance audit that needs to trace "who created this staff user", "who approved this refund", "who escalated this chat" can still answer those questions even after the actor is hard-deleted.

**How it's populated.**
- **Delete-time** (most rows). `OwnerApprovalService.hardDeleteStaffDirect` runs `UPDATE audit_logs SET actorNameSnapshot = ?, actorRoleSnapshot = ? WHERE userId = :id AND actorNameSnapshot IS NULL` just before deleting the User row.
- **Write-time** (new PR-CONSULT-4 audit paths). `updateProfile` and `hardDeleteStaffDirect` populate the snapshot when they create the new audit entry, plus the migration's `STAFF_ROLE_NORMALIZED_FROM_SALES` entries. Existing audit-write paths (the 14 call sites surveyed in the explore phase) **don't yet populate at write-time** — they get covered automatically by the delete-time UPDATE when the actor is eventually deleted.
- **Older rows** (pre-PR-CONSULT-4). Both columns stay null. The summary helper falls back to "(Removed user)" when the User join returns null AND the snapshot is null.

## 5. SALES enum cleanup

Postgres doesn't support `ALTER TYPE ... DROP VALUE`. The rename-and-recreate dance (rebuild the enum, swap the column type, drop the old enum) is risky on a live `users` table because it requires a brief column lock and a `USING role::text::"UserRole"` rewrite. We deferred it.

Instead the migration:
1. Re-stamps every `SALES` user to `CONSULTANT` (no live caller relies on the SALES distinction anymore).
2. Archives those users via `StaffActiveStatus.isActive = false`.
3. Audits each migration with `STAFF_ROLE_NORMALIZED_FROM_SALES` + actor snapshot.
4. Adds a `COMMENT ON TYPE "UserRole"` marking SALES as deprecated.

The DTO layer (`createStaffUserDirect`) rejects any new write that tries to assign SALES. The `ASSIGNABLE_ROLES` constant on the frontend excludes SALES from every dropdown. `User.role`'s Prisma `@default(SALES)` still references it because we didn't change the default — but no code path uses the default. A follow-up PR can flip it to CONSULTANT once we're confident.

## 6. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **Migration applied:** `cd backend && npx prisma migrate status` shows `20260521000000_pr_consult_4_staff_profile_and_lifecycle` applied.
3. **Schema columns exist:** `\d users` shows mobileNumber / countryOfResidence / address / emergencyContact; `\d audit_logs` shows actorNameSnapshot / actorRoleSnapshot.
4. **Data migration:**
   - `SELECT role, COUNT(*) FROM users WHERE role = 'SALES'` returns 0.
   - `SELECT u.email, s.isActive FROM users u JOIN staff_active_status s ON s."userId" = u.id WHERE u.email LIKE '%@sorenatest.com'` shows the test users with `isActive=false`.
5. **OWNER create flow:** Create a new staff user via the overlay. Mobile + country required; submit succeeds, TempPasswordModal appears, the new user appears in the list with mobile/country populated in the detail (decrypted).
6. **OWNER edit flow:** Click an existing user → Edit profile → change email + mobile + emergency contact → Save. Toast "Changes saved". Re-open detail to verify.
7. **Email uniqueness:** Edit two users to the same email — second one returns 409 "Email already in use" inline on the field.
8. **Archive / restore:** Click an active user → Archive → confirm → row turns muted in the list. Toggle "Show archived" on → row appears. Click → detail shows "Archived on {date} by {actor}". Restore → row goes active again.
9. **Hard delete (OWNER inline):** Click an archived non-OWNER user → Hard delete → type the user's exact name → red button enables → confirm. User disappears. Re-open the OWNER's audit log on this user: rows now show `actorNameSnapshot` populated.
10. **Hard delete (SUPER_ADMIN queued):** Sign in as SUPER_ADMIN → Hard delete a user → "Sent for owner approval" toast. As OWNER → `/staff/approvals` → see the `HARD_DELETE_STAFF` row with the target name + email + role resolved by the payload renderer. Approve → "Approved and executed." Target gone.
11. **Self-lockout guard:** Open your own row in detail. Change-role / Archive / Hard delete buttons absent. Edit profile button present (you can fix your own profile).
12. **OWNER protection:** Open an OWNER row. Same hide-destructive treatment.
13. **i18n:** flip locale to `fa`. CountryPicker shows Persian country names; form labels translated.
14. **Country picker:** searchable, flag emoji renders, code displays in the right rail. Pick "Iran" → field stores "IR".
15. **Rate limits:** burst 65 profile updates → 61st returns 429.

## 7. Known limitations

- **Email isn't wired.** TempPasswordModal stays the only way to surface the password on Create. Same limitation as PR-CONSULT-3; a follow-up PR pipes it through `EmailModule.sendEmail`.
- **Existing audit-write paths don't snapshot at write-time.** Fourteen call sites across `assignments`, `owner-approval`, `admission`, `chatbot`, `dashboard`, `meetings`, `tickets` still write audit rows without populating `actorNameSnapshot` / `actorRoleSnapshot`. The hard-delete service's UPDATE-before-delete covers them automatically, but until each is migrated, a hard-delete must happen for any snapshot to be filled in. Migrating each is a one-line addition; can land incrementally as files are touched.
- **`SALES` enum value retained.** See section 5. The rename-and-recreate dance is deferred. Don't assign SALES in new writes — the DTO blocks it.
- **Workload endpoint visibility.** The detail overlay calls `GET /api/staff/assignments/workload?staffId=` which currently requires admin tier; the panel just shows "—" if 403. Fine for the current flow.
- **OWNER promotion / demotion still SQL-only.** Same as PR-CONSULT-3. The UI hides OWNER from every role dropdown and prevents OWNER hard-delete / archive.
- **`mobileNumber` validation is regex-light.** Anything with 5–32 chars of digits / spaces / `+` / `-` / parens passes. We don't validate actual phone numbers (would need libphonenumber-js). Country dialing-code inference is a future polish.
- **`address` is plain text.** No structured address fields (street / city / postcode). Encrypted column stores whatever the user typed.
- **No audit-time-machine UI yet.** Snapshot columns exist; the staff-cases activity tab still shows live user join only. A follow-up can extend `summarizeAuditEntry` to consult the snapshot for actor name + role and fall back to `(Removed user)` when both the join and snapshot are null.

## 8. How to extend

- **Add a new profile column.** Schema migration → encrypt at create + update in service → expose in detail → add field in CreateStaffOverlay + EditStaffOverlay + StaffDetailOverlay → add i18n labels.
- **Migrate an existing audit-write path to populate snapshots.** Inject `prisma.user.findUnique({ where: { id: actorId }, select: { name: true, role: true } })` at the call site, pass the snapshot into the `auditLog.create` call. The summariser uses them automatically.
- **Add a new OwnerApprovalActionType.** Same playbook as PR-CONSULT-3 — extend the enum + migration, add an executor, add a frontend payload renderer, register in `ApprovalPayloadPreview`, add the i18n key under `staff.approvals.actionType.*`.
- **Switch the country list to a curated subset.** Replace `ALL_COUNTRY_CODES` in `frontend/src/lib/country-codes.ts` with a filtered list; the backend wrapper enforces validity against the full ISO catalogue regardless, so no security impact.

## 9. Security layers applied

- **Layer 1 — auth:** every route under `/api/staff/*` is gated by `JwtAuthGuard + StaffRolesGuard`. The new routes inherit this gate.
- **Layer 2 — role membership:** `@StaffRoles('OWNER', 'SUPER_ADMIN')` on PATCH `/:id` and DELETE `/:id` — ADMIN gets 403.
- **Layer 3 — encryption at rest:** mobile / address / emergency stored as AES-256-GCM ciphertext, base64. countryOfResidence is plain (analytics need).
- **Layer 4 — rate limits:** 60/hr profile updates, 10/hr hard deletes (per actor, DB-count). Queued hard-delete by SUPER_ADMIN is covered by the existing PR-CONSULT-1 owner-approval-create limit (50/hr).
- **Layer 5 — self-lockout guard:** UI hides destructive actions on the signed-in user's own row + on any OWNER row. Backend enforces "cannot hard-delete self" + "cannot hard-delete OWNER" independently — the UI is hide-not-disable for ergonomics, the backend is the security boundary.
- **Layer 6 — name-typing confirmation for hard delete.** OWNER must type the target's full name (case-sensitive) before the delete button enables. Deliberate speed bump.
- **Layer 7 — audit attribution survives hard-delete.** `actorNameSnapshot` + `actorRoleSnapshot` ensure historical rows retain author identity even when the User row is gone.
- **Layer 8 — payload doesn't include new values.** `STAFF_PROFILE_UPDATED` audit rows carry only the list of changed field names, not the new values themselves (which are already encrypted in their columns).
- **Layer 9 — DTO-layer country validation.** Custom `IsCountryCode` decorator wraps `isValidCountryCode` against the canonical ISO 3166-1 alpha-2 set; rejects lowercase + unknown codes.
- **Layer 10 — FK chain handled, P2003 surfaces as 409.** The hard-delete service pre-cleans the NO ACTION FKs (visa_case_assignments + owner_approval_requests) so the User delete succeeds. If a future schema change adds another NO ACTION FK we missed, the try-catch converts Prisma's P2003 into "Cannot hard-delete: user is referenced by another table. Archive instead." rather than a 500.

## 10. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git revert HEAD~1..HEAD

# 2. drop the new columns + enum value + restore SALES rows
psql -d sorenavisaplatform <<SQL
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "mobileNumber",
  DROP COLUMN IF EXISTS "countryOfResidence",
  DROP COLUMN IF EXISTS "address",
  DROP COLUMN IF EXISTS "emergencyContact";

ALTER TABLE "audit_logs"
  DROP COLUMN IF EXISTS "actorNameSnapshot",
  DROP COLUMN IF EXISTS "actorRoleSnapshot";

-- HARD_DELETE_STAFF enum value can't be dropped (Postgres). Leave it.
-- DELETE FROM owner_approval_requests WHERE "actionType" = 'HARD_DELETE_STAFF';
-- ^ optional cleanup if any pending requests reference the new type.

-- Restoring the SALES users to their previous role would require the
-- pre-migration backup snapshot — see backup_before_pr_consult_4.sql.

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260521000000_pr_consult_4_staff_profile_and_lifecycle';
SQL

# 3. push the revert
git push origin main
```

The DB backup taken before the migration lives at `backend/backup_before_pr_consult_4.sql` (gitignored). Restore from it if anything goes sideways — that bypasses both the schema teardown and the SALES re-assignment dance.

## Day 1 actions — onboarding follow-ups

Once this PR is deployed and you're signed in as OWNER:

1. **Fix Sheila Rose's email typo.** Open her detail → Edit profile → correct email → Save. No need to delete + recreate.
2. **Create the rest of the staff cohort with full profile data:**
   - **Iydin Tashvighi** — role `ADMIN` — email `iydin@sorenavisa.com` — mobile + country (NZ) — supply address + emergency contact if known.
   - **Elisa** — role `SUPPORT` — email `elisa@sorenavisa.com` — same.
   - **Arjmand (Finance)** — role `FINANCE` — email `finance@sorenavisa.com` — your second account for finance audit-trail separation.
3. **Verify archived test users.** Toggle "Show archived" on at `/staff/users` — `test@sorenatest.com`, `admin@sorenatest.com`, `sales@sorenatest.com`, `support@sorenatest.com` should appear muted with `Archived` badges. Toggle off → they disappear from the main list.
4. **Smoke the hard-delete flow once** in a safe direction (e.g. create a throwaway staff user, delete them inline as OWNER) so you have firsthand confidence in the name-typing confirmation + audit-snapshot behaviour before it matters.
