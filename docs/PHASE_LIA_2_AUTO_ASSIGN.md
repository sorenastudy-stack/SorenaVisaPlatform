# PR-LIA-2 — Auto-assign LIA on contract sign (+ manual reassignment)

The moment a contract is signed, an LIA gets attached to the case. Pure load-balancing for this PR (lowest current workload wins; ties to the oldest hire). Manual reassignment for OWNER / ADMIN / SUPER_ADMIN through a dedicated overlay. A forward-compat `User.specialisedCountries` column ships unused, ready for the country-aware router in PR-LIA-2.1.

## 1. What this PR does

Adds the missing handoff between **contract signed** and **LIA review begins**. Before this PR a signed contract sat in limbo until someone in ops manually nominated the next legal adviser. Now the DocuSign `completed` webhook fires a load-balanced auto-pick: every active LIA's current open-case count is calculated, the lowest count wins, and the chosen LIA is attached to the `Case` row in the same flow. An audit entry records the full candidate set so the decision is replayable.

Manual reassignment lives on a sibling endpoint: `PATCH /cases/:id/lia`, role-gated to `OWNER` / `ADMIN` / `SUPER_ADMIN` (LIAs themselves cannot reassign their own cases — that would create a hot-potato problem). The frontend wires this through a Reassign overlay on the case-detail page that pulls `GET /staff/lia-roster` to show every active LIA with their current workload count next to their name. A required reason (10–500 chars) lands on the audit row.

The auto-allocation logic mirrors PR-CONSULT-1's consultant load-balancer line for line: candidate filter (`role = 'LIA' AND isActive AND staffActiveStatus null OR active`), workload count, tie-break by `createdAt ASC`. The differences are surface-level — PR-CONSULT-1 counts `VisaCaseAssignment` rows (its staff-slot model), PR-LIA-2 counts `Case.liaId` directly. A code comment in the new service cross-references the original for future readers.

A `User.specialisedCountries: String[]` column ships in this PR but is **not** read by the auto-assignment yet. It exists so the future country-aware router (PR-LIA-2.1) can populate it without another migration. Empty array = "general", which is what every existing LIA's row will be after this migration applies.

No new env vars. No new npm dependencies. One Prisma migration. Contract sign is never blocked by an assignment failure (the call is wrapped in try/catch and logs — the contract update has already committed by the time we attempt to assign).

## 2. Files changed

Backend (new):
- `prisma/migrations/20260526150000_pr_lia_2_case_lia_assignment/migration.sql` — adds the `liaId` column + index + FK on `cases`, and `specialisedCountries TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` on `users`.
- `src/cases/lia-assignment.service.ts` — `getRoster()`, `assignLiaToCase()` (auto), `manualReassign()`. Owns the audit-pair writes + email best-effort. Exports the `RosterRow` type.
- `src/cases/lia-roster.controller.ts` — `@Controller('staff')` with `GET /staff/lia-roster`. Role-gated to `LIA / ADMIN / SUPER_ADMIN / OWNER` (LIAs can see the roster too — transparency on who's busy).
- `src/cases/dto/lia-assignment.dto.ts` — `ManualReassignLiaDto` (`liaId: string | null`, `reason: string (10–500)`).

Backend (existing):
- `prisma/schema.prisma` — `Case` gains `liaId String?` + `lia User?` relation (`"CaseLia"`, `onDelete: SetNull`) + `@@index([liaId])`. `User` gains the inverse `liaCases Case[]` and the forward-compat `specialisedCountries String[] @default([])`.
- `src/cases/cases.controller.ts` — `PATCH /cases/:id/lia` route, per-route `@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')`. Constructor now injects `LiaAssignmentService`.
- `src/cases/cases.module.ts` — registers `LiaAssignmentService` + `LiaRosterController` + imports `NotificationsModule`. Exports `LiaAssignmentService` so `ContractsModule` can resolve it.
- `src/contracts/contracts.service.ts` — `handleWebhook` now calls `liaAssignments.assignLiaToCase(contract.caseId)` after a `completed` status update, wrapped in try/catch. Adds a `Logger` for the auto-assignment trace.
- `src/contracts/contracts.module.ts` — imports `CasesModule` for the assignment-service injection.
- `src/notifications/notifications.service.ts` — two new public methods: `sendNewLiaAssignment` and `sendLiaAssignmentReleased`. Both delegate to the existing `sendEmail` (which silently warns on missing SMTP — no behaviour change for ops that haven't set up SMTP yet).
- `src/common/audit/audit.helper.ts` — three new `summarizeAuditEntry` cases: `LIA_AUTO_ASSIGNED`, `LIA_AUTO_ASSIGN_NO_CANDIDATES`, `LIA_MANUAL_REASSIGNED`.

Frontend (new):
- `src/app/lia/cases/[id]/ReassignLiaButton.tsx` — overlay client component. Pulls `/staff/lia-roster` on open, shows each LIA with their current open-case count, required reason field, PATCHes the case.

Frontend (existing):
- `src/app/lia/page.tsx` — dashboard gains a fifth "Assigned to me" stat card. Grid changed from `lg:grid-cols-4` to `lg:grid-cols-5`. `StatCard` `tone` union extended with `'gold'`.
- `src/app/lia/cases/page.tsx` — Owner column replaced with LIA column. New URL-driven Assignment chip (All / Mine / Unassigned). LIA viewers are one-shot redirected to `?assignment=mine` on first load (preserves any explicit URL param so an LIA can still browse the whole queue).
- `src/app/lia/cases/[id]/page.tsx` — Owner card replaced with Assigned-LIA card. Reassign button visible only to OWNER / ADMIN / SUPER_ADMIN. "(you)" suffix when the current viewer is the assigned LIA. CRM owner moved to the timestamp footer.

No new npm dependencies, no new env vars.

## 3. Schema added

```prisma
model Case {
  // ... existing ...
  liaId       String?
  lia         User?     @relation("CaseLia", fields: [liaId], references: [id], onDelete: SetNull)
  liaCases    // (inverse on User)
  // ... existing ...
  @@index([liaId])
}

model User {
  // ... existing ...
  specialisedCountries String[]  @default([])
  liaCases             Case[]    @relation("CaseLia")
  // ... existing ...
}
```

Migration `backend/prisma/migrations/20260526150000_pr_lia_2_case_lia_assignment/migration.sql`:

- `ALTER TABLE "cases" ADD COLUMN "liaId" TEXT` — nullable.
- `CREATE INDEX "cases_liaId_idx" ON "cases"("liaId")` — the workload-count query (`liaId = $1 AND stage NOT IN (...)`) needs this.
- FK with `ON DELETE SET NULL` — an LIA being hard-deleted (PR-CONSULT-4) leaves their cases unassigned rather than orphaning them. Audit-log snapshot columns retain attribution post-deletion.
- `ALTER TABLE "users" ADD COLUMN "specialisedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` — the `NOT NULL DEFAULT []` shape avoids a backfill step; existing rows get an empty array on read.

No new enums, no new tables.

## 4. Endpoint contract

| Method | Path | Role gate | Purpose |
|---|---|---|---|
| GET | `/staff/lia-roster` | `LIA / ADMIN / SUPER_ADMIN / OWNER` | Active LIAs with workload counts. Used by the manual-reassign dropdown. LIAs can see the roster (transparency on who's busy). |
| PATCH | `/cases/:id/lia` | `OWNER / ADMIN / SUPER_ADMIN` | Manual reassignment. Body `{ liaId: string \| null, reason: string (10–500) }`. `liaId: null` clears the assignment. |

The auto-assignment is not an HTTP endpoint — it's a side effect of `contracts.service.handleWebhook` when the DocuSign envelope flips to `completed`.

### Sample responses

`GET /staff/lia-roster`:

```json
[
  { "id": "cuid1", "name": "Aria Karimi",   "email": "aria@sorenavisa.com",   "openCases": 3 },
  { "id": "cuid2", "name": "Sheila Rose",   "email": "sheila@sorenavisa.com", "openCases": 5 },
  { "id": "cuid3", "name": "Mohsen Yousefi","email": "mohsen@sorenavisa.com", "openCases": 7 }
]
```

Sorted by `openCases ASC`, then `createdAt ASC` (the DB sort, preserved by the in-memory rearrangement).

`PATCH /cases/:id/lia` returns the updated `Case` row with `lia` included.

## 5. Auto-assignment algorithm

Pure function executed inside the transaction, mirroring PR-CONSULT-1:

```ts
// 1. Candidate pool
const candidates = await prisma.user.findMany({
  where: {
    role: 'LIA',
    isActive: true,
    OR: [
      { staffActiveStatus: null },
      { staffActiveStatus: { isActive: true } },
    ],
  },
  orderBy: { createdAt: 'asc' },
  include: {
    liaCases: {
      where: { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
      select: { id: true },
    },
  },
});

// 2. Empty → audit "no candidates" and leave the case unassigned.
if (candidates.length === 0) return /* no-op + audit row */;

// 3. Lowest count wins. Linear scan preserves DB's createdAt ordering
//    so ties go to the oldest hire.
let pick = candidates[0]!;
for (const c of candidates) {
  if (c.liaCases.length < pick.liaCases.length) pick = c;
}
```

### Pre-conditions

- `Case.liaId === null` — if the case already has an LIA the service returns `{ status: 'already_assigned' }` without touching anything. Re-assignment is the manual endpoint's job.

### Forward-compat field

`User.specialisedCountries` is **not** consulted by the auto-assignment. It exists for PR-LIA-2.1's country-aware router. Empty array = "general"; future logic will fall back to the load-balanced pool when no specialist matches.

### Replay-ability

Every auto-assignment writes one `AuditLog` row with:

```json
{
  "eventType": "LIA_AUTO_ASSIGNED",
  "newValue": {
    "liaId": "winner-cuid",
    "liaName": "Aria Karimi",
    "candidates": [
      { "id": "cuid1", "name": "Aria Karimi",   "openCases": 3 },
      { "id": "cuid2", "name": "Sheila Rose",   "openCases": 5 },
      { "id": "cuid3", "name": "Mohsen Yousefi","openCases": 7 }
    ]
  },
  "actorNameSnapshot": "System (contract signed)",
  "actorRoleSnapshot": "SYSTEM"
}
```

So any future audit can re-derive why a particular LIA won at a particular moment.

## 6. Manual reassignment matrix

| Viewer role | Can see roster | Can PATCH `/cases/:id/lia` |
|---|---|---|
| `LIA` (any) | Yes | **No** — would be reassigning themselves |
| `OWNER` | Yes | Yes |
| `ADMIN` | Yes | Yes |
| `SUPER_ADMIN` | Yes | Yes |
| `STUDENT` / others | No | No |

Backend validation on `PATCH /cases/:id/lia` when `liaId` is non-null:

- Target user exists.
- `target.role === 'LIA'` (rejecting an attempt to assign a CONSULTANT or SUPPORT user as LIA).
- `target.isActive === true`.
- `target.staffActiveStatus?.isActive !== false` (allows the `null` case — never deactivated).

Any failure throws `400 BAD_REQUEST` with a specific message.

Side effects on success:

- `Case.liaId` updates.
- One `LIA_MANUAL_REASSIGNED` audit row with `oldValue: { liaId, liaName }` and `newValue: { liaId, liaName, reasonLength }`.
- Best-effort emails to the new LIA (`sendNewLiaAssignment`) and the released LIA (`sendLiaAssignmentReleased`). Both are fire-and-forget — failures log but don't propagate.

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260526150000_pr_lia_2_case_lia_assignment` applied. `\d cases` shows `liaId` column + `cases_liaId_idx`. `\d users` shows `specialisedCountries`.
3. **Roster route reachable:**
   ```bash
   curl -s -i -H "Authorization: Bearer <jwt-of-lia>" http://localhost:3001/staff/lia-roster | head -5
   # expect 200 + a JSON array
   ```
4. **Auto-assign on contract sign.** From an existing Case with no `liaId`, simulate a DocuSign `completed` webhook (or call `contracts.service.handleWebhook(envelopeId)` directly from the REPL). Confirm:
   - `SELECT id, "liaId" FROM cases WHERE id = '<caseId>'` now has the winner's user-id.
   - `SELECT "eventType", "newValue" FROM audit_logs WHERE "entityId" = '<caseId>' ORDER BY "createdAt" DESC LIMIT 1` shows `LIA_AUTO_ASSIGNED` with `candidates` containing every active LIA.
   - Backend log line: `LIA Aria Karimi (cuid) auto-assigned to case <id> on contract sign`.
5. **No-LIAs path.** Soft-deactivate every LIA in the DB (`UPDATE staff_active_status SET "isActive" = false WHERE "userId" IN (SELECT id FROM users WHERE role = 'LIA')`). Simulate another sign. Confirm:
   - `liaId` stays NULL.
   - Audit row `LIA_AUTO_ASSIGN_NO_CANDIDATES` exists.
   - Contract record is still updated to `signedAt` etc. (the sign is not blocked).
6. **Manual reassignment, happy path.** As an `OWNER` user, visit `/lia/cases/<id>`. The "Reassign" button is present. Click it; the overlay lists every active LIA with their open-case counts. Pick a different one, type ≥10 chars, hit Reassign. Refresh — header shows the new LIA. Audit row `LIA_MANUAL_REASSIGNED` exists with `oldValue` + `newValue`.
7. **Manual reassignment, role gate.** As an `LIA` user, visit the same page. Reassign button is **not** rendered. Hitting the endpoint directly returns 403.
8. **Roster validation.** As OWNER, post `PATCH /cases/<id>/lia` with `{ liaId: '<a-CONSULTANT-user-id>', reason: 'try wrong role' }` → expect 400 "Target user is not an LIA".
9. **Default-to-mine for LIA viewers.** Log in as an LIA, visit `/lia/cases` with no query. You should be redirected to `?assignment=mine` once. Click the "All" chip — URL becomes `/lia/cases?assignment=` (cleared) and the redirect does not fire again.
10. **Dashboard 5th card.** Visit `/lia`. "Assigned to me" card shows the count of open cases where `liaId = my user id`. Card uses the gold tone variant.
11. **Email best-effort.** If `SMTP_HOST` is unset, both auto and manual flows still succeed — backend log line `Email not sent to <addr>: SMTP configuration missing`. No error bubbles up.
12. **Audit log summary:** open the activity feed (anywhere `summarizeAuditEntry` renders) — `LIA_AUTO_ASSIGNED` reads as `LIA auto-assigned: <name>`, `LIA_MANUAL_REASSIGNED` reads as `LIA reassigned: <prev> → <next>`, `LIA_AUTO_ASSIGN_NO_CANDIDATES` reads as `Contract signed but no active LIA was available`.

## 8. Known limitations

- **Auto-assignment does not consider `specialisedCountries`.** The column ships unused — PR-LIA-2.1 is the country-router PR. Today every LIA is treated as a generalist.
- **Contract-sign hook is non-transactional with the assignment.** The contract update commits first; the assignment runs in a follow-up `await`. If the backend crashes between the two, the contract is signed but the case is unassigned. Re-running the webhook (DocuSign retries on non-2xx) is the recovery path; idempotency is preserved because the service is a no-op when `liaId` is already set.
- **Archive vs deactivation is a single state.** `StaffActiveStatus.isActive = false` is treated as "not eligible for auto-assignment". There's no separate "out-of-office" / vacation state — that's deferred per the spec.
- **An archived LIA's existing cases stay assigned.** Archiving doesn't auto-reassign their open cases. The case-detail page does not yet show a banner warning that "this LIA is archived, please reassign" — that's a small follow-up (the schema fields are already there, just needs a UI check).
- **Manual reassignment requires a reason of at least 10 chars** — there's no "I just clicked the wrong thing" undo. By design: every assignment change is audit-grade.
- **No bulk reassign.** Each case is one PATCH. PR-LIA-11 territory.
- **No notification channels beyond email.** No Slack, no in-app banner, no push. PR-LIA-9 will add a `NotificationModel` and routing.
- **Workload count is "open cases" not "currently active in inbox".** A case in `RESOLVED`-equivalent state still counts toward the LIA's load until the case `stage` flips to `COMPLETED` or `WITHDRAWN`. If a finer-grained "active work" definition is needed (e.g. exclude cases past a certain threshold), the `findActiveLias` helper's `where.liaCases.stage` clause is the surgical place to extend.
- **Roster does not paginate.** For now Sorena has a handful of LIAs and the dropdown renders all of them. At >50 active LIAs this would want a server-side search.
- **The "(you)" badge on the LIA card uses `session.userId` directly.** No additional verification — the layout already gated the page to LIA/ADMIN/SUPER_ADMIN/OWNER roles and the session payload is JWT-verified by middleware.

## 9. How to extend

- **PR-LIA-2.1 — country router.** Read `specialisedCountries` in `findActiveLias`: first filter candidates whose array `contains` the case's destination country; if none, fall back to the full load-balanced pool. The destination country lives on `Lead.countryRaw` (free text) or the lead's `Contact.countryOfResidence` (alpha-2). Decide which is the canonical source at that point.
- **Add an "out of office" toggle on `StaffActiveStatus`.** New nullable `outOfOfficeUntil DateTime?`. The candidate filter excludes LIAs where `outOfOfficeUntil > now()`. Reuse the existing `StaffActiveStatus` row, no new model.
- **Add bulk reassignment.** New endpoint `POST /cases/bulk-reassign-lia` with `{ caseIds: string[], liaId: string | null, reason: string }`. Service runs the same per-case logic inside one `$transaction`. Frontend extends `/lia/cases` with row checkboxes.
- **Add an archive-banner.** Frontend case-detail check: if `caseData.lia` resolves and `caseData.lia.staffActiveStatus?.isActive === false`, render a red banner with a deep-link to the Reassign button. Backend already exposes the `staffActiveStatus` join on the user; just include it on `Case.lia`.
- **Add in-app notifications.** Build the `Notification` Prisma model (recipient, kind, body, readAt). Add `NotificationsService.createInApp(...)` and call alongside the existing `sendEmail` from `LiaAssignmentService`. Frontend reads `GET /students/me/notifications` (or the per-staff equivalent) on layout render — pattern matches the PR-LIA-4 unread badge.
- **Add load-balancing weights.** Today every LIA has equal "capacity = 1". If senior LIAs should take 2× the load of juniors, extend `User` with `assignmentCapacityWeight Int @default(1)` and divide each candidate's `liaCases.length` by their weight before picking the lowest. Schema-level change but transparent to the call sites.

## 10. Security layers applied

- **Layer 1 — Auth.** All new routes use `JwtAuthGuard`. Roster route is decorated `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`. Manual-reassign route is `@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')`. The PATCH route's role gate is per-method (not class-wide), keeping the existing `GET /cases` accessible to its broader audience.
- **Layer 2 — Role gate.** Backend `RolesGuard` is authoritative. Frontend layout already gates the entire `/lia/*` portal at the edge + the server-component layer. The new Reassign button is also frontend-gated by reading `session.role` server-side and conditionally rendering — UX-only; the backend remains the source of truth.
- **Layer 3 — Env vars.** No new env vars. Email uses the existing `SMTP_*` set; missing config falls back to a warning log (preserved behaviour). The new `APP_URL` reference in the email template defaults to `https://app.sorenavisa.com` if unset — no breakage if the var doesn't exist.
- **Layer 4 — HTTPS.** Production enforced by Vercel + Railway; no code.
- **Layer 5 — Rate limiting.** Inherits the global 60/min throttler. No per-endpoint throttle added — these are low-frequency staff actions.
- **Layer 6 — Audit log.** Every state change writes one `AuditLog` row inside the same `$transaction` as the data update. Snapshot columns (`actorNameSnapshot`, `actorRoleSnapshot`) are populated at write time per PR-CONSULT-4. Even the "no candidates" path writes an audit row so an unassigned case after contract sign is never silent.
- **Layer 7 — File uploads.** N/A — no files touch this PR.
- **Layer 8 — Auto-logout.** Handled by the existing session-expiry middleware; no change.
- **Layer 9 — npm audit.** No new dependencies. Baseline unchanged.
- **Layer 10 — DB backups.** One new nullable column on `cases` + one new array column on `users`. The existing nightly Postgres backup picks them up automatically.

**Non-blocking note.** The contract-sign side effect (LIA auto-assign) runs `await`-wrapped in a try/catch around `assignLiaToCase`. The contract `UPDATE` has already committed by the time we attempt the assignment, so any failure in the assignment path (DB outage, race condition) leaves the contract correctly marked signed and the case correctly marked unassigned. The next webhook delivery (DocuSign retries on non-2xx, but the route returns 200 even if assignment fails) won't double-assign because the service is idempotent against an already-assigned case.

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-2 commits
git revert HEAD~1..HEAD

# 2. drop the new columns + index + FK
psql -d sorenavisaplatform <<SQL
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_liaId_fkey";
DROP INDEX IF EXISTS "cases_liaId_idx";
ALTER TABLE "cases" DROP COLUMN IF EXISTS "liaId";

ALTER TABLE "users" DROP COLUMN IF EXISTS "specialisedCountries";

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260526150000_pr_lia_2_case_lia_assignment';
SQL

# 3. push the revert
git push origin main
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/staff/lia-roster -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
curl -i -X PATCH http://localhost:3001/cases/<id>/lia ...
#   → 404
```

A rollback strips the LIA-assignment surface but leaves the rest of the LIA portal (PR-LIA-1, PR-LIA-4) intact. Cases that auto-assigned before the rollback retain their `liaId` value only until the column is dropped; the contract-sign side effect reverts to the original no-op shape. Audit rows from the rollback window remain in `audit_logs` (just with no matching column on `cases` to dereference) — the `entityId` column carries the case id so future forensic queries still work.
