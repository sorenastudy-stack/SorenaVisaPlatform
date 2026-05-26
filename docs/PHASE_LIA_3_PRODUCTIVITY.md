# PR-LIA-3 — Case-age tracking + OWNER-only LIA productivity report

Every case now knows when its LIA was attached. A new OWNER / ADMIN / SUPER_ADMIN-only report at `/lia/productivity` aggregates six metrics per LIA so the founder can see, at a glance, who is fast, who is overloaded, who is taking longest on resolutions, and who responds quickest to clients. The same data is exposed to the backend for a future LIA self-view widget.

## 1. What this PR does

Adds the missing time-anchor on `Case`: `liaAssignedAt` is now stamped inside the same transaction that touches `liaId`, on both the auto-assignment path (contract-sign hook, PR-LIA-2) and the manual-reassignment path (`PATCH /cases/:id/lia`). When `liaId` is cleared, `liaAssignedAt` is cleared too. A one-off idempotent backfill in the migration synthesises `liaAssignedAt = createdAt` for any case that had an LIA from PR-LIA-2 but no recorded assignment time.

A new productivity service computes six metrics per LIA on demand — no caching, no precompute, recomputed every page load:

- **openCases** — cases where `liaId = lia.id AND stage NOT IN ('COMPLETED','WITHDRAWN')`.
- **totalAssigned** — lifetime cases ever attached to this LIA.
- **avgDaysToFirstAction** — for each case, the days between `liaAssignedAt` and the earliest of (first `LegalNote` authored by this LIA, first `CaseMessage` authored by this LIA). PR-LIA-1 risk-overrides / hard-stop clears live only in `audit_logs` today and are intentionally not counted yet (would require a second pass over the audit table; deferred until value is proven).
- **avgDaysToResolution** — for cases now in `COMPLETED`/`WITHDRAWN`, `updatedAt - liaAssignedAt`.
- **decisionsThisMonth** — `LegalNote` rows authored by this LIA with `decision IS NOT NULL` and `createdAt >= start of current calendar month`.
- **avgClientResponseHours** — for every `CaseMessage` with `authorRole = 'CLIENT'`, the gap until the next LIA-authored message on the same case, in hours. Pairs without a follow-up reply are excluded (in-flight conversations don't drag the average down).

A new page at `/lia/productivity` renders the report as a table on desktop and stacked cards on mobile. Strict OWNER / ADMIN / SUPER_ADMIN gate at three layers: the existing edge middleware (`/lia/*`), the LIA layout's role-check, and a new page-level redirect that bounces LIA viewers back to `/lia`. The matching backend route enforces the same set via `@Roles`.

A small but consequential fix lands alongside: `cases.service.findAll` and `findOne` now include the `lia` relation. PR-LIA-2 added the UI for showing the assigned LIA on both the queue and the detail page, but the case-fetch services didn't actually project the relation — so every case rendered as "Unassigned" regardless. With this PR's include, the PR-LIA-2 UI starts working as intended.

No new env vars. No new npm dependencies. One migration. The page is server-rendered; no client-side state, no real-time refresh.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260526170000_pr_lia_3_lia_assigned_at/migration.sql` — adds `liaAssignedAt TIMESTAMP(3)` on `cases` + the idempotent backfill (`UPDATE … WHERE liaId IS NOT NULL AND liaAssignedAt IS NULL`).
- `src/cases/lia-productivity.service.ts` — `getRoster()` + `getMyStats(liaUserId)`. Exports the `LiaProductivityRow` type.
- `src/cases/lia-productivity.controller.ts` — `@Controller('staff')`, `@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')`. Two routes (`/lia-productivity`, `/lia-productivity/:liaId`).

Backend (existing):
- `prisma/schema.prisma` — `Case` gains `liaAssignedAt DateTime?`.
- `src/cases/cases.module.ts` — registers `LiaProductivityService` + `LiaProductivityController`. Exports the service.
- `src/cases/cases.service.ts` — `findAll` + `findOne` include `lia: { select: { id, name, email } }` so the PR-LIA-2 UI surfaces the assignee.
- `src/cases/lia-assignment.service.ts` — `assignLiaToCase` writes `liaAssignedAt: new Date()` alongside `liaId`. `manualReassign` writes `liaAssignedAt: new Date()` when assigning, `null` when clearing.

Frontend (new):
- `src/app/lia/productivity/page.tsx` — server component. Layered role gate, table + stacked-cards layout, "Generated X ago" badge.

Frontend (existing):
- `src/app/lia/_utils/format.ts` — adds `formatDaysSince(date)` and `openCasesStyles(count)` helpers.
- `src/app/lia/cases/[id]/page.tsx` — `CaseDetail` interface gains `liaAssignedAt: string | null`. The Assigned-LIA card footer gains "Case age: N days" and (when distinct from case age) "Assigned N days ago".
- `src/components/portal/PortalLayout.tsx` — `NavItem` interface gains optional `requiresRoleIn?: string[]`. The `navItems` derivation filters by role. New LIA-portal entry "LIA Productivity" (icon: `LineChart`) gated to `['OWNER', 'ADMIN', 'SUPER_ADMIN']`.

No new npm dependencies, no new env vars.

## 3. Schema added

```prisma
model Case {
  // ... existing ...
  liaAssignedAt DateTime?
  // ... existing ...
}
```

Migration `backend/prisma/migrations/20260526170000_pr_lia_3_lia_assigned_at/migration.sql`:

```sql
ALTER TABLE "cases" ADD COLUMN "liaAssignedAt" TIMESTAMP(3);

-- Idempotent one-off backfill: any case that already has an LIA
-- attached (from PR-LIA-2 auto-assignment) gets a synthetic
-- liaAssignedAt = createdAt. The "IS NULL" guard makes this safe to
-- re-run — only rows without a value are touched.
UPDATE "cases"
   SET "liaAssignedAt" = "createdAt"
 WHERE "liaId" IS NOT NULL
   AND "liaAssignedAt" IS NULL;
```

The backfill is intentionally crude: `createdAt` predates assignment by some unknown delta for the older rows. The first real metric pass post-deploy will look skewed-low on resolution times for those backfilled rows; they'll wash out as new assignments accumulate with truthful timestamps. No index added — the productivity service queries `liaId` (already indexed from PR-LIA-2) and reads `liaAssignedAt` from the same row.

### Open-cases color thresholds

The badge on the productivity report's "Open cases" column uses these bands, picked to surface "needs help" before it becomes a fire:

| Open cases | Tone | Rationale |
|---|---|---|
| 0 | emerald | nothing on the desk |
| 1–3 | blue | healthy in-progress |
| 4–7 | amber | watching capacity |
| 8+ | red | overloaded — consider reassignment |

A footnote on the page restates the bands so OWNER doesn't have to remember them.

## 4. Endpoint contract

| Method | Path | Role gate | Purpose |
|---|---|---|---|
| GET | `/staff/lia-productivity` | `OWNER / ADMIN / SUPER_ADMIN` | Productivity rows for every LIA (active + archived). Sorted busiest-first; ties alphabetical. |
| GET | `/staff/lia-productivity/:liaId` | `OWNER / ADMIN / SUPER_ADMIN` | Single LIA — same row shape. UI consumer is a future drill-down (PR-LIA-3.1). |

### Sample response (`GET /staff/lia-productivity`)

```json
{
  "rows": [
    {
      "id": "cuid1",
      "name": "Sheila Rose",
      "email": "sheila@sorenavisa.com",
      "isActive": true,
      "openCases": 9,
      "totalAssigned": 41,
      "avgDaysToFirstAction": 1.2,
      "avgDaysToResolution": 28.5,
      "decisionsThisMonth": 6,
      "avgClientResponseHours": 4.3
    },
    {
      "id": "cuid2",
      "name": "Aria Karimi",
      "email": "aria@sorenavisa.com",
      "isActive": true,
      "openCases": 3,
      "totalAssigned": 12,
      "avgDaysToFirstAction": 0.8,
      "avgDaysToResolution": null,
      "decisionsThisMonth": 0,
      "avgClientResponseHours": null
    }
  ],
  "generatedAt": "2026-05-26T17:14:22.110Z"
}
```

`null` values are the explicit signal "not enough data yet" — the frontend renders them as a muted `—`. No `0.0` collisions ("she's instant" vs "she has no data").

## 5. Productivity metric semantics

### avgDaysToFirstAction

Window: `liaAssignedAt → earliest LIA action`. The action set considered:

- A `LegalNote` row authored by this LIA (notes + decisions both qualify).
- A `CaseMessage` row with `authorRole = 'LIA'` and `authorId = lia.id`.

PR-LIA-1's risk overrides + hard-stop clears live only in `audit_logs` today. Including them would require either pulling those rows in the same query (extra index hit per LIA-case) or maintaining a denormalised `firstActionAt` column. Neither felt worth the cost for the v1 metric. If the user reports that a hot-take risk override should "count" as a first action, the surgical fix is in `lia-productivity.service.ts` `earliestActionMs` — add an `audit_logs` lookup there.

Cases with `liaAssignedAt = NULL` are excluded from the average but still count toward `totalAssigned` / `openCases`. This is defensive — the migration backfill should guarantee no such cases exist post-deploy.

### avgDaysToResolution

Window: `liaAssignedAt → updatedAt` for cases now in `COMPLETED` or `WITHDRAWN`. `updatedAt` is auto-managed by Prisma's `@updatedAt`; whatever flipped the stage to a terminal state most recently touched it, so this is a reasonable proxy without adding a new `resolvedAt` column. If the user later wants strict "first time the stage became terminal" semantics, a dedicated `resolvedAt: DateTime?` set in the stage-update path is the clean upgrade.

### avgClientResponseHours

For every `CaseMessage` with `authorRole = 'CLIENT'` on a case assigned to this LIA, walks forward in the same case looking for the next `authorRole = 'LIA'` message. Records the gap. Averages across all such (client → LIA-reply) pairs. Conversations where the client is still waiting for a reply contribute zero data — by design. The metric is "how fast does this LIA respond", not "how many clients are waiting".

Two-controller wrinkle: the conversation thread service uses `authorRole` as the ground truth, not `authorId`. The query in `computeAvgClientResponseHours` walks every message on every case the LIA was ever assigned to — for a small staff size this is one extra query per LIA per page load. The N+1-style pattern is documented in §8 below.

### decisionsThisMonth

Calendar month, server timezone (Pacific/Auckland in prod). Resets at midnight on the 1st of each month. Counts `LegalNote` rows where `authorId = lia.id AND decision IS NOT NULL AND createdAt >= start_of_month`. A pure-Prisma count call — no walk over the cases collection. Restart-of-month semantics are documented here; if a user expects a rolling 30-day window the toggle is one line in `computeStatsFor`.

## 6. Role-gating contract

Three layers, on the way in:

1. **Edge middleware** (`frontend/src/middleware.ts`) — `/lia/*` allowed to `LIA / ADMIN / SUPER_ADMIN / OWNER`. Unchanged from PR-LIA-2.
2. **LIA layout** (`frontend/src/app/lia/layout.tsx`) — re-checks the same set in the server component.
3. **Page-level redirect** (`frontend/src/app/lia/productivity/page.tsx`) — `if (session.role not in OWNER/ADMIN/SUPER_ADMIN) redirect('/lia')`. The bounce is silent — no error page, no "you don't have access" banner; an LIA who types the URL just lands on their dashboard.

Backend authority:

- `LiaProductivityController` decorated `@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')` with `RolesGuard`. Returns 403 to LIA users. **This is the source of truth** — the frontend gate is UX-only; a malicious LIA bypassing the redirect cannot read the data.

UX:

- `PortalLayout` nav filters items by `requiresRoleIn`. LIA users never see the "LIA Productivity" entry. The nav for OWNER / ADMIN / SUPER_ADMIN includes it.

Verification probes:

- As LIA: `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <lia-jwt>" http://localhost:3001/staff/lia-productivity` → `403`.
- As OWNER: same curl → `200`.

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260526170000_pr_lia_3_lia_assigned_at` applied. `\d cases` shows the new `liaAssignedAt` column.
3. **Backfill happened:** `SELECT COUNT(*) FROM cases WHERE "liaId" IS NOT NULL AND "liaAssignedAt" IS NULL` returns 0 immediately after the migration. Running the migration UPDATE statement again leaves the count at 0 — idempotent.
4. **Fresh auto-assignment writes the timestamp:** flip a contract to `completed` (DocuSign webhook or direct service call). `SELECT "liaId", "liaAssignedAt" FROM cases WHERE id = '<id>'` shows both columns populated, `liaAssignedAt` within seconds of `now()`.
5. **Manual reassignment writes the timestamp:** as OWNER, PATCH `/cases/:id/lia` with a new `liaId`. Confirm `liaAssignedAt` advanced to roughly `now()` (replacing the prior value, not appended).
6. **Unassign clears the timestamp:** PATCH `/cases/:id/lia` with `liaId: null, reason: '...'`. Confirm both columns are NULL.
7. **Case-detail card shows the new lines:** open `/lia/cases/<id>` for a case with an assigned LIA. The card footer reads "Case opened … · updated …", "Case age: N days", and "Assigned N days ago" — the last only when it differs from case age.
8. **`/lia/productivity` renders for OWNER:** log in as OWNER, click the new "LIA Productivity" sidebar entry. Table populates with one row per LIA. Open-cases badge uses the color band from §3.
9. **`/lia/productivity` redirects an LIA:** log in as an LIA user, type `/lia/productivity` into the URL bar. Page should bounce back to `/lia` instantly. The sidebar should NOT show the "LIA Productivity" entry.
10. **Backend authority:** as LIA, `curl -i -H "Authorization: Bearer <jwt>" http://localhost:3001/staff/lia-productivity` returns `403`.
11. **Null-data rendering:** if no LIA has resolved any case, the "Avg days · resolution" column shows `—` for every row. If no client → LIA pair exists, "Avg client response (h)" shows `—`.
12. **Detail endpoint:** `curl -i -H "Authorization: Bearer <owner-jwt>" http://localhost:3001/staff/lia-productivity/<liaId>` returns one row in the same shape.
13. **PR-LIA-2 carryover fix verified:** the LIA queue (`/lia/cases`) now shows the assignee in the LIA column (it was always rendering "Unassigned" before this PR because the case-fetch service didn't include the relation).

## 8. Known limitations

- **N+1 query pattern in `getRoster`.** One `findMany` per LIA for cases-with-events, then one count for `decisionsThisMonth`, then one extra query for `avgClientResponseHours`. With single-digit LIAs this is fine — three rows × three queries = nine round trips. At 50+ active LIAs this would want a single tabular SQL with LATERAL joins or a denormalised `case_lia_stats` materialised view. Documented in the service file itself so the trigger condition is obvious to a future reader.
- **No caching.** Every page load triggers the full recompute. Acceptable given the staff scale; if rendering ever exceeds ~500ms in practice, a per-LIA cache with a 30s TTL is the obvious next step.
- **PR-LIA-1 risk/hard-stop actions don't count as a "first action".** They live in `audit_logs`, not in `legal_notes` (legal notes' `decision` field captures the formal decision but not the in-flight risk override). The `earliestActionMs` helper only walks `legalNotes` and `caseMessages`. Adding an `audit_logs` lookup per case would close the gap.
- **`avgDaysToResolution` uses `updatedAt`** as a proxy for "case resolved at". If a case is marked WITHDRAWN and then has its notes edited a week later, the resolution date drifts. The clean fix is a dedicated `resolvedAt: DateTime?` column set in the stage-update path — deferred to a future PR.
- **`decisionsThisMonth` resets on the 1st.** A decision made on the 31st at 23:59 is gone from the counter at midnight. A rolling 30-day window would be more useful; the toggle is one Prisma query change.
- **`avgClientResponseHours` ignores in-flight conversations.** A client message with no LIA reply is excluded from the average. Intentional — the metric is response speed, not response coverage — but worth flagging in the next user training.
- **No per-LIA drill-down UI.** The `:liaId` endpoint ships but no consumer exists. PR-LIA-3.1 territory.
- **No CSV / Excel export.** The report is screen-only. PR-LIA-12 will add the file-export plumbing once we need it.
- **No time-bucketed trends.** Metrics are point-in-time. "Sheila this week vs last week" requires snapshotting; out of scope.
- **No targets / KPIs.** The report shows "Sheila's avg-resolution is 28.5 days". It doesn't show "Sheila's avg-resolution is 28.5 days vs the 21-day target". Targets need OWNER-set thresholds — separate PR.
- **No LIA self-view in this PR.** `getMyStats(liaUserId)` ships ready to wire to a future `/lia/me/stats` route or sidebar widget. Deferred until product decides whether LIAs should see their own numbers (visibility into self-tracking can be motivating or anxiety-inducing depending on team norms).
- **`isActive` archived LIAs still appear in the roster.** Intentional — historical metrics for someone who just left the team are still informative. The row gets an "Archived" pill so it's obvious.
- **Open-cases bands are heuristic.** Picked by feel. If the user runs the report and says "8 is fine, 12 is when I'd worry", change the thresholds in `openCasesStyles` (one place).
- **Carryover fix:** `cases.service.findAll` + `findOne` now include `lia` — this should have shipped with PR-LIA-2. If any existing API consumer relied on the previously-missing `lia` field being undefined, this is a silent behaviour change. None in the current codebase do.

## 9. How to extend

- **PR-LIA-3.1 — per-LIA drill-down.** New `/lia/productivity/[liaId]/page.tsx` consuming the existing `:liaId` endpoint. Show a per-case table with "days open", "first action at", "last activity", "decision (if any)". Link rows to `/lia/cases/<id>`.
- **PR-LIA-3.2 — CSV export.** Once PR-LIA-12 ships the file-export utility, add a "Download CSV" button. Same backend endpoint; new serialiser.
- **Time-bucketed trends.** Snapshot the productivity rows nightly to a `lia_productivity_snapshots` table (`id, liaId, capturedAt, ...metric columns`). Render week-over-week deltas in a sparkline column. Requires the new table + a cron job — out of scope for the user's current dev-tooling but a one-evening PR.
- **OWNER-set targets / KPIs.** New `lia_targets` table keyed on `userId` with `targetDaysToFirstAction`, `targetDaysToResolution`, etc. The report cell renders red/green based on actual-vs-target. UI: an OWNER-only "Set targets" overlay on the page.
- **LIA self-view widget.** Add a card to the LIA dashboard (`/lia/page.tsx`) that calls `GET /lia/me/stats` (new endpoint that delegates to `LiaProductivityService.getMyStats(req.user.userId)`). Strict per-user; no peer comparison. Decide whether to ship before A/B'ing with the team.
- **Risk/hard-stop actions in first-action calculation.** Extend `earliestActionMs` to also peek at `audit_logs` for rows with `entityType='CASE' AND entityId=case.id AND eventType IN ('LIA_RISK_OVERRIDDEN', 'LIA_HARD_STOP_CLEARED')`. Costs one extra index lookup per case; matches the user's likely mental model of "first action".
- **Replace `updatedAt` with `resolvedAt`.** Add `Case.resolvedAt DateTime?`. Populate it in the case-update path whenever `stage` transitions to `COMPLETED` or `WITHDRAWN`. Replace the `updatedAt` reference in `avgDaysToResolution` with the new column. Surgical change once you have a use case.

## 10. Security layers applied

- **Layer 1 — Auth.** Both new routes use `JwtAuthGuard`. Page-level `getSession()` check on the frontend route.
- **Layer 2 — Role gate.** Backend `@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')` is authoritative. Frontend layers (middleware, layout, page-level redirect, nav-item filter) are UX-only. The PR-LIA-2 LIA role is **explicitly not** in the allowed set — peer-comparison data is privileged.
- **Layer 3 — Env vars.** No new env vars.
- **Layer 4 — HTTPS.** Production enforced by Vercel + Railway.
- **Layer 5 — Rate limiting.** Inherits the global 60/min throttler. No per-endpoint throttle; report is internal-only and the staff load is small.
- **Layer 6 — Audit log.** Productivity endpoints are read-only — **no audit rows are written**. The PR follows the standard read pattern of every other read-only endpoint in the project (`GET /staff/lia-roster`, `GET /staff/users`, etc).
- **Layer 7 — File uploads.** N/A.
- **Layer 8 — Auto-logout.** Handled by the existing session-expiry middleware; no change.
- **Layer 9 — npm audit.** No new dependencies.
- **Layer 10 — DB backups.** One nullable column on `cases`; the existing nightly Postgres backup picks it up.

**No PII exposure beyond LIA names + emails** — the report intentionally aggregates and does not reveal individual client names or case details. The drill-down endpoint (`:liaId`) returns the same aggregate shape, not a per-case list. PR-LIA-3.1 will need to think harder about what fields to project when it surfaces per-case data to OWNER.

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-3 commits
git revert HEAD~1..HEAD

# 2. drop the new column
psql -d sorenavisaplatform <<SQL
ALTER TABLE "cases" DROP COLUMN IF EXISTS "liaAssignedAt";

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260526170000_pr_lia_3_lia_assigned_at';
SQL

# 3. push the revert
git push origin main
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/staff/lia-productivity -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
```

Rolling back strips the productivity surface and the `liaAssignedAt` column. PR-LIA-2's auto-assignment continues to work because `assignLiaToCase` previously set only `liaId`; the new `liaAssignedAt` write was layered on top and is reverted with the commit. The PR-LIA-2 LIA card on the case-detail page reverts to its pre-PR-LIA-3 footer (just "Case opened … · updated …"), and the include-fix in `cases.service` reverts with the commit — meaning the LIA column on the queue will silently start showing "Unassigned" again until PR-LIA-2's UI bug is re-fixed separately.
