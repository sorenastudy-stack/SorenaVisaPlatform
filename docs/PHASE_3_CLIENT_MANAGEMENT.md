# PHASE 3 — Client Management (Cases Feature, "Option 1")

> Handover document. Written so a developer joining in 6 months can read **only this file** and understand the Cases feature completely.
>
> **Status:** ✅ Done and live in production.
> **Live frontend:** https://sorena-visa-platform-aawd.vercel.app
> **Final commit on `main`:** `79c4d9f`
> **Date completed:** 2026-06-17

---

## 1. What this phase does — plain English

This phase makes the staff **Cases** feature real. A "case" is a student's file as it moves through the consultancy (e.g. Marcus Lee, in the ADMISSION stage). Each case has **four staff roles assigned to it**: an Immigration Adviser (LIA), an Admission Specialist (internally called CONSULTANT), a Support person, and a Finance person.

Staff can open any case at `/staff/cases`, see who is assigned to all four roles, and **reassign** any role to a different eligible staff member — with a written reason that is **permanently recorded** in an audit log. Every reassignment keeps a full, append-only history: who lost the role, who gained it, who made the change, when, and why.

This replaces the old visa-side assignment system (`visa_case_assignments`) with a simpler model where the assignment lives directly on the `cases` table.

---

## 2. Files created or changed

All paths are relative to the repo root. The repo is `https://github.com/sorenastudy-stack/SorenaVisaPlatform`.

### Frontend (Next.js — deploys to Vercel)

| File | Purpose |
|------|---------|
| `frontend/src/components/staff/cases/detail/CaseAssignmentsPanel.tsx` | Renders the ASSIGNMENTS card with the four role rows and their **Reassign** buttons. Each button only opens the picker overlay — it does not assign anyone by itself. |
| `frontend/src/components/staff/cases/detail/ReassignOverlay.tsx` | The pop-up dialog that opens when "Reassign" is clicked. Holds the `SLOT_CONFIG` map (see §3), fetches eligible staff, collects the 10–500 char reason, and fires the PATCH request on Confirm. |
| `frontend/src/components/staff/cases/detail/CaseDetailClient.tsx` | The case-detail page that mounts `CaseAssignmentsPanel` and refreshes data after a reassignment. |
| Staff Cases **list** page (repointed in Step 1) | Reads from the `cases` table instead of the legacy source. |
| Staff Cases **detail** page (repointed in Step 2) | Reads from the `cases` table. |

### Backend (NestJS — deploys to Railway)

| File | Purpose |
|------|---------|
| `backend/src/cases/cases.controller.ts` | Defines the four PATCH routes: `/cases/:id/lia`, `/cases/:id/owner`, `/cases/:id/support`, `/cases/:id/finance`. Each delegates to the service below. |
| `backend/src/cases/lia-assignment.service.ts` | Core logic. Contains `manualReassign` (LIA), `reassignOwner` (CONSULTANT/Admission Specialist), `reassignSupport`, `reassignFinance`. Each updates the column **and** writes an audit-log row inside one atomic DB transaction. This is the file changed in the final commit to persist the reason text. |

### Database

| File | Purpose |
|------|---------|
| `backend/prisma/schema.prisma` | `Case` model gained `supportId` and `financeId` columns + foreign keys + indexes (Step 4a). |
| Migration for Step 4a | Adds `Case.supportId` and `Case.financeId`. **Applied manually** — see §3 and "Known limitations". |

---

## 3. Database tables / columns added

### `Case` table — new columns (Step 4a, commit `c1d7f51`)

| Column | Type | Meaning |
|--------|------|---------|
| `supportId` | nullable FK → `users.id` | The staff member assigned to the Support role for this case. |
| `financeId` | nullable FK → `users.id` | The staff member assigned to the Finance role for this case. |

These join the pre-existing `liaId` (Immigration Adviser) and `ownerId` (Admission Specialist / CONSULTANT) columns. So the `Case` row now holds **all four** assignment slots directly:

```
Case.liaId      → Immigration Adviser  (role slot key: LIA)
Case.ownerId    → Admission Specialist (role slot key: CONSULTANT)
Case.supportId  → Support              (role slot key: SUPPORT)
Case.financeId  → Finance              (role slot key: FINANCE)
```

Foreign keys, indexes, and the `_prisma_migrations` tracking row were all verified present in production.

> ⚠️ **Important:** This migration was applied **manually via the Railway Data tab**, not by the normal `prisma migrate deploy`. See Known Limitations §7.

### `audit_logs` table — used, not altered

No schema change was needed for the history feature. The existing `AuditLog` model already has a `newValue` column of type `Json?`, so the reason text fits inside it without a migration.

Each reassignment writes one append-only `audit_logs` row:

| Field | Value for a reassignment |
|-------|--------------------------|
| `userId` | The staff member who made the change (FK to `users`). |
| `action` | `'MANUAL_REASSIGN'` |
| `eventType` | One of `LIA_MANUAL_REASSIGNED`, `OWNER_MANUAL_REASSIGNED`, `SUPPORT_MANUAL_REASSIGNED`, `FINANCE_MANUAL_REASSIGNED` — this encodes **which role** was reassigned. |
| `entityType` | `'CASE'` |
| `entityId` | The case id. |
| `oldValue` (JSON) | The previous assignee's id + name. |
| `newValue` (JSON) | The new assignee's id + name, plus `reason` (full text) and `reasonLength` (count). |
| `actorNameSnapshot` | Frozen copy of the actor's name — survives the actor being deleted later. |
| `actorRoleSnapshot` | Frozen copy of the actor's role. |
| `createdAt` | Timestamp of the change. |

To reconstruct a case's full assignment history:

```sql
SELECT * FROM audit_logs
WHERE "entityType" = 'CASE' AND "entityId" = '<case-id>'
  AND "eventType" IN ('LIA_MANUAL_REASSIGNED', 'OWNER_MANUAL_REASSIGNED',
                      'SUPPORT_MANUAL_REASSIGNED', 'FINANCE_MANUAL_REASSIGNED',
                      'LIA_AUTO_ASSIGNED')
ORDER BY "createdAt" ASC;
```

### `SLOT_CONFIG` — the map that ties it all together

Lives in `ReassignOverlay.tsx`. This single map drives all four slots so there is no per-slot branching:

```ts
const SLOT_CONFIG = {
  LIA:        { label: 'Immigration Adviser',  path: (id) => `/cases/${id}/lia`,     bodyKey: 'liaId'     },
  CONSULTANT: { label: 'Admission Specialist', path: (id) => `/cases/${id}/owner`,   bodyKey: 'ownerId'   },
  SUPPORT:    { label: 'Support',              path: (id) => `/cases/${id}/support`, bodyKey: 'supportId' },
  FINANCE:    { label: 'Finance',              path: (id) => `/cases/${id}/finance`, bodyKey: 'financeId' },
};
```

> Note: "Admission Specialist" is a **display label only**. The underlying role key in code and database is still `CONSULTANT` / `ownerId`. Don't rename the key — only the UI label changed.

---

## 4. Environment variables added

**None.** This phase added no new environment variables. It uses the existing database connection and auth already configured for the backend.

---

## 5. Third-party services connected

No new third-party services. Existing infrastructure used:

| Service | Role | Where to manage |
|---------|------|-----------------|
| **Vercel** | Hosts the Next.js frontend (`sorena-visa-platform-aawd`). Auto-deploys on push to `main`. | Vercel dashboard → Deployments. |
| **Railway** | Hosts the NestJS backend (`SorenaVisaPlatform`) + Postgres database. Backend auto-rebuilds on push to `main`. | Railway dashboard → project `SorenaVisaPlatform`. |
| **Railway Postgres** | The production database (Prisma). **Not Supabase.** | Railway → Postgres service → Data tab for queries; Backups tab for backups. |

---

## 6. How to test it works (manual test)

1. Go to `https://sorena-visa-platform-aawd.vercel.app/staff/cases` and sign in with Google as an OWNER/admin account.
2. Open the **Marcus Lee** case.
3. Confirm the **ASSIGNMENTS** card shows four rows: Immigration Adviser, Admission Specialist, Support, Finance — each with a **Reassign** button.
4. Click **Reassign** on the Support row. A dialog titled "Reassign Support" opens.
5. Click the name box (it pre-selects the current person) and pick a **different** eligible person from the dropdown.
6. Type a reason of at least 10 characters, e.g. `Testing reason text saves correctly`.
7. Click **Confirm reassignment**. The dialog closes and the Support row shows the new person.
8. **Verify the history saved** — in Railway → Postgres → Data tab, run:
   ```sql
   SELECT COUNT(*) FROM audit_logs WHERE "newValue"->>'reason' = 'Testing reason text saves correctly';
   ```
   The count should be **1 or more**. This proves the reason **text** (not just its length) is permanently stored.

✅ All steps above were verified passing on 2026-06-17.

---

## 7. Known limitations

- **Migrations don't auto-apply.** The backend's `start.sh` does not run `prisma migrate deploy` on deploy, so new migrations must be **applied manually via the Railway Data tab**. The Step 4a columns (`supportId`, `financeId`) were added this way. This is a known gap to fix properly later.
- **Reason text is now stored, but old rows aren't backfilled.** Audit rows written *before* commit `79c4d9f` contain only `reasonLength` (a number), not the `reason` text. New rows have both. If full historical reasons are ever needed, a backfill would be required — but the old text was never captured, so it cannot be recovered.
- **`ipAddress` not recorded on reassignments.** The `audit_logs` table has an `ipAddress` column, but the reassign code path leaves it null. The `userId` still attributes every action, so this is minor.
- **No dedicated assignment-history table.** The `Case` row's four id columns are overwritten in place on each reassignment. History lives only in `audit_logs` rows (which is sufficient and append-only).

---

## 8. How a future developer would extend this

- **Add a fifth role slot (e.g. "Marketing"):**
  1. Add the column (e.g. `marketingId`) to `Case` in `schema.prisma`, create + apply the migration (remember: apply manually via Railway Data tab for now).
  2. Add a PATCH route in `cases.controller.ts` and a `reassignMarketing` method in `lia-assignment.service.ts`, copying the existing pattern (update column + write audit row in one transaction).
  3. Add an entry to `SLOT_CONFIG` in `ReassignOverlay.tsx` and to the `SLOTS` array in `CaseAssignmentsPanel.tsx`. No other frontend change needed — the panel renders every slot from that array.

- **Build a visible "history timeline" on the case page:** query `audit_logs` for the case (see §3 SQL) and render the rows. The data is already being captured; only a read view is missing.

- **Change who is eligible for a slot:** the eligible-staff list is served by the backend `eligible-staff?slot=...` endpoint; widen or narrow the staff query there.

---

## 9. Security layers applied (from the project's 10-layer standard)

| Layer | Applied? | Where |
|-------|----------|-------|
| **2. Row-Level / role-based access** | ✅ | Reassign buttons are wrapped in a `<PermissionGate require="canReassign">` on the frontend; the backend routes are auth-guarded (JWT `req.user`). Only authorised staff can reassign. |
| **6. Audit log of admin actions** | ✅ | Every reassignment writes an append-only `audit_logs` row with actor, old value, new value, reason text, and timestamp. This is the core of this phase. No UPDATE path exists against `audit_logs` anywhere in the codebase, so rows are durable. |
| **4. HTTPS only** | ✅ | Vercel + Railway default. |
| **3. Secrets in env vars** | ✅ | No secrets added; DB connection stays in Railway env, never in code. |

Layers not directly touched by this phase (1 Google OAuth, 5 rate limiting, 7 signed file URLs, 8 idle timeout, 9 npm audit, 10 daily backups) are handled at the platform level or in other phases.

> **Atomicity note:** The column update and the audit-log write are wrapped in a single `prisma.$transaction(...)`. You can never end up with a changed assignment but no audit record, or vice versa.

---

## 10. Rollback instructions

If this phase needs to be undone:

1. **Revert the frontend + backend code:**
   ```bash
   # Roll back to the commit immediately before this phase's final state.
   # The reason-text change was 79c4d9f; the frontend 4c was 334d20f.
   # To undo only the reason-text persistence:
   git revert 79c4d9f
   git push origin main
   ```
   To roll back the whole Cases feature, revert the chain of commits in reverse order:
   `79c4d9f → 334d20f → 939ce6e → c1d7f51 → 44bf4cc → 82d719e → 38baf1f`.

2. **Database columns (`supportId`, `financeId`):** these are nullable and additive, so leaving them in place is harmless even after a code rollback. If you must remove them, do it manually via the Railway Data tab (since migrations don't auto-apply):
   ```sql
   ALTER TABLE "Case" DROP COLUMN IF EXISTS "supportId";
   ALTER TABLE "Case" DROP COLUMN IF EXISTS "financeId";
   ```
   ⚠️ Only do this if no code still references those columns — otherwise the backend will error.

3. **Audit-log rows:** leave them. They are an append-only history and should not be deleted on rollback.

4. **Take a database backup first** (Railway → Postgres → Backups) before any destructive step.

---

## Appendix — Commit history for this phase

| Commit | What it did |
|--------|-------------|
| `38baf1f` | Step 1 — staff Cases **list** repointed to read the `cases` table. |
| `82d719e` | Step 2 — staff Cases **detail** repointed to the `cases` table. |
| `44bf4cc` | Step 3a/3b — LIA + Admission Specialist reassignment; relabel "Consultant" → "Admission Specialist" (display only). |
| `c1d7f51` | Step 4a — migration adding `Case.supportId` + `Case.financeId` (applied manually via Railway). |
| `939ce6e` | Step 4b — Support/Finance reassign endpoints; widened eligible-staff; detail returns all 4 slots. |
| `334d20f` | Step 4c — frontend: all 4 slots reassignable via `SLOT_CONFIG`. |
| `79c4d9f` | Reason text persisted in audit log for all 4 slots (this phase's final commit). |

---

*Stack reference: Next.js (Vercel) frontend + NestJS (Railway) backend + Railway Postgres via Prisma. Not Supabase. Admin/OWNER account: `yashoue@gmail.com`.*
