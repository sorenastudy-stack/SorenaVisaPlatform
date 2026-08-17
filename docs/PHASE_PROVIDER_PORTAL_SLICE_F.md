# Provider Portal — Slice F: Analytics Panel

**Status:** DONE — 17 August 2026
**Depends on:** Slices A–E.
**Completes:** the Education Provider Portal thread.

---

## 1. What this phase does

An institution can see two numbers per programme: how often our matcher put it in
front of a student, and how often a student then chose it on an application.

That is the whole feature. The interesting decisions are all about what is *not*
there:

- **Nothing comparative.** No platform totals, no ranking, no "4th of 23". An
  institution seeing its position relative to others is a different product with
  different consent behind it, and the absence is enforced by a test rather than
  left to habit.
- **No visa-approved metric.** Left out per the brief — but see §7, because the
  stated reason for deferring it turned out not to be the real one.
- **No pre-aggregation.** One query with two correlated counts, scoped to the
  caller. A cached table can drift; this cannot.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/provider-portal/provider-analytics.controller.ts` | `GET /provider/analytics`. One route, no id anywhere. |
| `backend/src/provider-portal/provider-analytics.service.ts` | One query, filtered by the caller. |
| `backend/src/provider-portal/provider-analytics-boundary.spec.ts` | 8 source-property tests, including the "nothing comparative" absence test. |
| `frontend/src/app/provider/analytics/page.tsx` + `components/provider/ProviderAnalytics.tsx` | The panel. |

**Changed**
| File | Change |
|---|---|
| `backend/src/provider-portal/provider-portal.module.ts` | Registers the controller. |
| `frontend/src/components/provider/ProviderShell.tsx` | Fourth and final nav destination. |

## 3. Database changes

**None.** No migration, no new column, no aggregate table. The counts come from
`RecommendationItem` and `AdmissionProgrammeChoice` as they already exist.

## 4. Environment variables

None added.

## 5. Third-party services

None added.

## 6. How to test it works

Sign in as a provisioned institution and open **Performance**.

**What was actually run, 17 Aug 2026** — two institutions, real
Contact → Lead → Case → RecommendationList / AdmissionApplication chains, real
`RecommendationItem` and `AdmissionProgrammeChoice` rows:

```
18/18 checks passed
  an institution can read its own panel            HTTP 200
    lists exactly its own programmes               Business, Design, Nursing
    Nursing: suggested twice, chosen twice         2/2
    Business: suggested once, chosen once          1/1
    Design: never suggested, never chosen          0/0
    a zero is explained — Design is not live       isActive=false, PENDING
    totals are the sum of its own rows             3 / 3 / 3
    and they match a direct database count         panel 2/2 vs db 2/2
  provider B appears nowhere in A's panel
  provider B sees only its own                     1 programme, counts 1/1
    and no platform-wide total leaks in            B totals 1/1 while the database holds more
  a query string naming another institution changes nothing
  POST / PATCH / DELETE are not routes             404 ×3
  an anonymous request is refused                  401
  test institutions, programmes, recommendations and choices removed   0 left
```

The counts are checked against a **direct database count**, not merely against
each other — a panel that agrees with itself proves nothing.

**In a real browser**: **9/9** — the Performance nav appears, both programmes are
listed, the table cells read `1 / 1` for the recommended-and-chosen programme and
`0 / 0` for the untouched one, the zero row is annotated *not being offered*, no
schema words reach the screen, nothing comparative appears, no console errors.

Suites: backend **113 / 1409**, frontend **5 / 53**.

**The guards were proven able to fail:**

| Reintroduced mistake | Suite |
|---|---|
| the provider filter dropped from the query | RED |
| a count replaced by a per-programme query shape | RED |
| a write verb added to a read-only panel | RED |
| the provider id read from the query string | RED |
| (restored) | GREEN |

## 7. Known limitations

- **⚠ The visa-approved deferral reason in the brief was wrong, twice.** It was
  stated as needing "`OfferRecord` actually being written somewhere in the
  admission flow first". Both halves fail on inspection:
  1. **`OfferRecord` IS written.** `offer.service.ts` has create/update/delete
     and `offer.controller.ts` exposes `GET`/`POST`/`PATCH`/`DELETE`. It has
     **0 rows in dev** — the path exists and is unused, which is a different
     problem from a path that does not exist.
  2. **Visa approval would not come from `OfferRecord` anyway.** An offer is an
     institution's decision; a visa is Immigration's. The field that would answer
     it is `Application.status = VISA_APPROVED` (the enum value exists, and
     `Application` carries both `providerId` and `programmeId`, plus
     `visaDecisionAt`).

  **The real blocker:** all **1,102** `Application` rows in dev sit at
  `PREPARATION`. Nothing in the flow ever advances the status, so the metric
  would return 0 for every institution forever. Fix that and the metric is a
  one-line count — no schema work, no new model.
- **"Suggested" counts list *entries*, not distinct students.** One student
  regenerating their recommendations twice counts twice. That is the honest
  reading of "times recommended" but it is not "how many people saw this".
- **No time dimension.** All-time totals only; no "this month" and no trend.
- **No conversion rate.** `chosen / suggested` is deliberately not computed: at
  these volumes a 1-of-1 would display as 100%.
- **Counts include soft-deleted-by-deactivation programmes**, which is correct —
  history does not disappear because a programme was switched off — but a
  long-inactive programme keeps its old numbers with no date to explain them.

## 8. How a future developer would extend this

Add a field to the `select` and a column to the table. The `where` clause is the
entire security model here, so anything added must stay inside it.

For a time dimension, both source tables carry `createdAt`; that becomes a
`groupBy` with a date filter rather than `_count`, and is the point at which
"live-queried, no pre-aggregation" deserves re-testing.

For visa-approved: make the admission flow advance `Application.status`, then
count `{ programmeId, status: 'VISA_APPROVED' }`. Nothing else is needed.

**Do not add a comparative metric here without a decision about consent.** The
spec has an absence test that will fail, deliberately.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication / role | `JwtAuthGuard`, `RolesGuard`, `@Roles('PROVIDER')`; anonymous is 401 |
| Tenancy | The single query is filtered by the guard-resolved `providerId`; no route accepts an id in path, query or body |
| Read-only | No write verb on the controller, asserted by test; `POST`/`PATCH`/`DELETE` are 404 |
| Disclosure | No other institution is read at all — no totals, ranking, averages or percentiles anywhere in the payload |
| Data minimisation | No student identity of any kind: counts only, never who was recommended or who applied |

## 10. Rollback instructions

Code-only; revert the commit. No migration, no data written by this slice, and
nothing else reads the endpoint.
