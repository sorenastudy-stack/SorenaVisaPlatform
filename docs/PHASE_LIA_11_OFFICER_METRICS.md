# PR-LIA-11 — Officer Metrics dashboard

PR-LIA-10 introduced the data layer: officer profiles, attributed observations, and case-officer linkages with a snapshotted outcome at link time. PR-LIA-11 is the analytics surface on top of it: a cross-officer dashboard for OWNER+ and a per-officer trend section on the officer detail page that every LIA can read. Built on Recharts (the single new frontend dependency), no schema changes, no migrations, no maintained counters — every query is a read-time aggregate per Decision 3A.

---

## 1. Scope

In:

* New backend `OfficerMetricsService` with 3 methods (`getPlatformMetrics`, `getPlatformOutliers`, `getOfficerTrend`)
* New backend `OfficerMetricsController` mounted under `/officers/*` (registered before the existing officers controller so literal `/metrics` segments match before `/:id`)
* One new audit event type registered for future use (`OFFICER_OUTLIER_SCAN_RUN` — no endpoint writes it in this PR)
* Recharts 3.8.1 as the chart library (only new npm dep)
* New `/lia/officers/metrics` platform dashboard page
* 4 frontend chart client components (DecisionsOverTime, TopCountries, CaseStagePie, ApprovalRateBar)
* Per-officer `<OfficerTrendCharts>` client component on the officer detail page
* "Officer Metrics" sidebar nav entry (OWNER+ gated)
* "View metrics →" link on the officers index page (OWNER+ gated)

Out (deferred):

* PR-LIA-11.1 — Officer comparison view (pick two, render side-by-side)
* PR-LIA-11.2 — Custom date-range selector beyond 6/12 months
* PR-LIA-11.3 — Response-time tracking (requires capturing INZ-side timestamps)
* PR-LIA-11.4 — Drill-down click-through from chart segments to filtered case lists
* PR-LIA-11.5 — Configurable outlier thresholds (currently hardcoded)
* CSV / PDF export (PR-LIA-12 will introduce the file-export plumbing)
* Email alerts on outlier threshold breach
* Real-time updates via WebSocket
* Historical snapshots ("this quarter vs last quarter")
* OWNER-set thresholds for outlier detection

---

## 2. Routes

| Verb | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/officers/metrics?windowMonths=6\|12` | **OWNER / ADMIN / SUPER_ADMIN** | Platform dashboard payload — totals, decisions-over-time, leaderboard, country breakdown, stage distribution |
| GET | `/officers/metrics/outliers` | **OWNER / ADMIN / SUPER_ADMIN** | High-decline / under-observed / most-active / new-on-platform lists |
| GET | `/officers/:id/metrics?windowMonths=6\|12` | **LIA / ADMIN / SUPER_ADMIN / OWNER** | Per-officer trend data — quarterly buckets, country breakdown, stage distribution, days-since-last-linkage |

LIA can see per-officer metrics because officer-level analytics are part of the shared knowledge base from PR-LIA-10's Decision 2C. The platform-wide cross-officer comparison view is OWNER-level only because peer leaderboards are sensitive.

All routes use `req.user?.userId ?? req.user?.id` (d95640d) — though this PR is read-only, the helper pattern stays consistent for any follow-up writes.

---

## 3. Outlier thresholds — hardcoded values for OWNER tuning later

The thresholds below are baked into `officer-metrics.service.ts`. They're returned in the `/officers/metrics/outliers` response under the `thresholds` field so the UI can render them transparently. PR-LIA-11.5 will move them to `PlatformSetting` for runtime configurability — for now they're conservative defaults that suit a small officer roster.

| Threshold | Value | Rationale |
|---|---|---|
| High decline rate — minimum % | **70%** | Two-thirds is the natural "this stands out" line; 70% leaves a buffer above |
| High decline rate — minimum decisions | **5** | Don't flag an officer with 2/2 declined; small sample noise |
| High decline rate — lookback window | **6 months** | Long enough to smooth weekly noise, short enough to reflect current behaviour |
| Under-observed — minimum linkages | **10** | Officers with double-digit caseload warrant institutional knowledge |
| Under-observed — max observations | **< 3** | Two or fewer observations on 10+ linkages is the under-observed signal |
| Most active — lookback window | **30 days** | "Currently active" rather than "historically prolific" |
| New on platform — lookback window | **7 days** | First-linkage-this-week catches the officer in the moment |

If OWNER wants different thresholds before PR-LIA-11.5 ships, hardcoding new values requires a small code edit and redeploy — the values are private `const`s at the top of the service. Document any change in the audit log via a PR.

---

## 4. Backend — files added / modified

### New (2)

* [backend/src/immigration-officers/officer-metrics.service.ts](../backend/src/immigration-officers/officer-metrics.service.ts) — 3 methods + month/quarter bucket helpers
* [backend/src/immigration-officers/officer-metrics.controller.ts](../backend/src/immigration-officers/officer-metrics.controller.ts) — 3 routes under `/officers/*`

### Modified (2)

* [backend/src/immigration-officers/immigration-officers.module.ts](../backend/src/immigration-officers/immigration-officers.module.ts) — register the metrics controller + service. **Metrics controller registered FIRST** so its literal `/metrics` and `/metrics/outliers` paths match before `ImmigrationOfficersController`'s `/:id` param route would otherwise swallow them.
* [backend/src/common/audit/audit.helper.ts](../backend/src/common/audit/audit.helper.ts) — `OFFICER_OUTLIER_SCAN_RUN` registered for a future manual-trigger pattern (no endpoint writes it in this PR)

---

## 5. Frontend — files added / modified

### New (6)

* [frontend/src/app/lia/officers/metrics/page.tsx](../frontend/src/app/lia/officers/metrics/page.tsx) — server-rendered dashboard
* [frontend/src/app/lia/officers/metrics/DecisionsOverTimeChart.tsx](../frontend/src/app/lia/officers/metrics/DecisionsOverTimeChart.tsx) — stacked-bar (Recharts BarChart)
* [frontend/src/app/lia/officers/metrics/TopCountriesChart.tsx](../frontend/src/app/lia/officers/metrics/TopCountriesChart.tsx) — horizontal stacked-bar
* [frontend/src/app/lia/officers/metrics/CaseStagePieChart.tsx](../frontend/src/app/lia/officers/metrics/CaseStagePieChart.tsx) — donut with stageStyles palette
* [frontend/src/app/lia/officers/metrics/ApprovalRateBar.tsx](../frontend/src/app/lia/officers/metrics/ApprovalRateBar.tsx) — pure HTML/CSS approval-rate bar (no Recharts; saves bundle weight for a primitive visual)
* [frontend/src/app/lia/officers/[id]/OfficerTrendCharts.tsx](../frontend/src/app/lia/officers/[id]/OfficerTrendCharts.tsx) — client component wrapping the three charts; 6/12-month toggle re-fetches and re-renders

### Modified (3)

* [frontend/src/components/portal/PortalLayout.tsx](../frontend/src/components/portal/PortalLayout.tsx) — "Officer Metrics" nav item (BarChart3 icon, OWNER+ gated via `requiresRoleIn`)
* [frontend/src/app/lia/officers/page.tsx](../frontend/src/app/lia/officers/page.tsx) — OWNER+ gated "View metrics →" link in the page header
* [frontend/src/app/lia/officers/[id]/page.tsx](../frontend/src/app/lia/officers/[id]/page.tsx) — adds `<OfficerTrendCharts officerId={...}>` between Observations and Linked Cases

---

## 6. Data shape highlights

### Platform metrics

```ts
{
  windowMonths: 6 | 12,
  generatedAt: ISO,
  totals: { totalOfficers, activeOfficers, totalLinkages, totalDecisions,
            approvedCount, declinedCount, pendingCount },
  decisionsOverTime: [{ monthLabel, monthStart, approved, declined, pending }],
  approvalRateLeaderboard: top-10 [{ officerId, fullName, branch,
                                     totalDecisions, approvalRatePct, declineRatePct }],
  topCountries: top-10 [{ country, caseCount, approvedCount, declinedCount }],
  caseStageDistribution: [{ stage, count }]
}
```

### Outliers

```ts
{
  generatedAt: ISO,
  highDeclineRate: [{ officerId, fullName, branch, totalDecisions, declineRatePct }],
  underObserved:   [{ officerId, fullName, totalLinkages, observationCount }],
  mostActive:      top-5 [{ officerId, fullName, branch, recentLinkageCount }],
  newOnPlatform:   [{ officerId, fullName, firstLinkedAt }],
  thresholds: { …the constants above… }
}
```

### Per-officer trend

```ts
{
  officerId, windowMonths, generatedAt,
  quarterlyDecisions: [{ quarterLabel, quarterStart, approved, declined, pending }],
  topCountries: top-5 [{ country, caseCount }],
  caseStageDistribution: [{ stage, count }],
  daysSinceLastLinkage: number | null
}
```

`daysSinceLastLinkage` is computed across **all** linkages (not just within the window) so a stale officer surfaces even when looking at a 6-month window.

---

## 7. Time bucketing

* **Months** anchor to start-of-month UTC. `startOfMonth(now, -windowMonths + 1)` gives the first bucket. Iteration walks forward one month at a time using `Date.UTC(year, month + 1, 1)`.
* **Quarters** anchor to the start of the calendar quarter (Jan/Apr/Jul/Oct). Same pattern — walk forward by `+3` months.
* No `date-fns` / `luxon` / `dayjs` — pure `Date` arithmetic + `Intl.DateTimeFormat` for the human-readable `"Oct 2025"` label. Keeps the bundle lean and the spec constraint honoured ("no date manipulation libraries").
* All bucket math is done in UTC. The dashboard's "Last 6 months" label is approximate (it always anchors at start-of-month) — a query made on November 15 sees buckets for `Jun, Jul, Aug, Sep, Oct, Nov`. Acceptable for the analytics use case.

---

## 8. Performance + scale notes

At Sorena's expected scale (< 500 officers, < 10000 linkages) the queries are cheap:

* The platform metrics endpoint fires 5–6 queries: `count`, `findMany` over linkages in window, `groupBy(officerId)`, `groupBy(officerId, linkedOutcome)`, then two enriching `findMany` calls and a per-stage `findMany` for the distribution.
* The country breakdown does one extra `findMany` with a Lead → Contact join. If `linkages × cases` ever crosses ~50k rows, denormalising `countryOfResidence` onto `CaseOfficerLinkage` at link time would let the country breakdown stay a single `groupBy`. The schema column already exists on Contact — the join is not yet a problem.
* The outlier endpoint scans all linkages once via `groupBy(officerId)` for the under-observed check. Same threshold — fine to ~50k linkages; needs a covering index above that.
* Charts render in the browser; Recharts uses `ResponsiveContainer` with `ResizeObserver` so mobile resize works out of the box.

---

## 9. Constraints honoured

* Exactly one new npm dependency: `recharts@^3.8.1`
* No new env vars
* No schema changes / migrations / maintained counter columns — all queries are read-time aggregates per PR-LIA-10's Decision 3A
* No real-time updates / WebSockets
* Platform metrics gated to OWNER+; per-officer trends readable by every LIA-portal viewer
* `req.user?.userId ?? req.user?.id` everywhere (this PR is read-only so it doesn't surface, but the helper pattern stays consistent)
* Recharts components all marked `'use client'` (Recharts uses browser APIs and can't SSR)
* Data fetching stays server-side on the platform metrics page; the per-officer trend card fetches client-side because the window toggle needs to re-render without full navigation
* `OFFICER_OUTLIER_SCAN_RUN` registered in the audit helper for a future manual-trigger pattern — this PR doesn't add an endpoint that writes it

---

## 10. Backlog

* **PR-LIA-11.1 — Officer comparison view.** Pick two officers, render their stats side-by-side. Shares the per-officer trend query — likely a `/lia/officers/compare?ids=a,b` route + a column-pair layout.
* **PR-LIA-11.2 — Custom date-range selector.** Beyond 6/12 months. Could be a from/to date picker; needs schema-level care so we don't blow out the in-memory bucketing helpers (they're sized linearly with the window).
* **PR-LIA-11.3 — Response-time tracking.** "How long did INZ take to decide?" requires capturing `inzSubmittedAt` (already on Case from PR-LIA-7) and `visa.issuedAt` (already on Visa from PR-LIA-8) and computing the delta. Add it as a derived metric in `getPlatformMetrics` and a chart panel.
* **PR-LIA-11.4 — Drill-down click-through.** Click a chart segment → land on `/lia/cases?filter=officer:abc&outcome=DECLINED&window=6mo`. Frontend-only change for the recharts onClick handlers; the queue page already supports the filter chips.
* **PR-LIA-11.5 — Configurable thresholds.** Move the 7 constants in `officer-metrics.service.ts` to `PlatformSetting` rows. OWNER edits via an admin tool. Care needed — changing the threshold mid-window changes what counts as an outlier; an audit row should accompany every threshold change.
* **CSV / PDF export.** PR-LIA-12 will introduce the export plumbing; metrics is an early consumer.
* **Email alerts on outlier breach.** Daily cron that runs `getPlatformOutliers()`, dedup'd against the previous run, emails the OWNER on new entries. Companion `VisaExpiryReminderSent`-style ledger.
* **OWNER-set outlier thresholds with audit trail.** Once PR-LIA-11.5 ships, every threshold change writes a `PLATFORM_SETTING_UPDATED` audit row. Useful for retrospectives ("how did our outlier count change after we tightened the threshold?").
* **Per-officer dashboards for LIAs viewing their own assignments.** A future surface could show "officers reviewing your cases" with their stats. Currently the LIA sees every officer's stats indiscriminately — fine for institutional-knowledge use, but a personalised view could surface decision patterns specific to that LIA's portfolio.
* **`/health/officer-metrics` endpoint.** Returns `{ lastComputedAt, queryDurationMs }` for on-call observability if metrics queries ever get slow.
* **Migrate from "approximate" filter values on officers index.** The index page builds branch/country chips from the current page's data, which is approximate. A `GET /officers/distinct-values` endpoint would let chips show the full distinct set — useful as the officer roster grows.
