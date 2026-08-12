# Phase — Accounting Dashboard

**Date:** 12 August 2026
**Commits:** `2490ed1` (dashboard) · `41010d9` (revenue + GST aggregation)
**Route:** `/staff/accounting/dashboard`

## 1. What this does

A front page for the company accountant: the state of the money at a glance, above the
read-only reporting screens that already exist. Built from a complete external design
spec (design system, 16 charts, all copy), adapted where the spec described data the
platform does not have.

Six of the sixteen cards carry real figures — payments by status, payments by type,
invoices by status, students per month, money received by month, and GST for the current
return period — plus the exchange rate. **The rest say so rather than drawing a zero.**
That is the substance of this phase: the dashboard tells the truth about how much the
platform currently knows.

Built in two passes, then extended in a third:

1. Layout against the design spec's example figures.
2. Wiring to what the platform actually records, with honest empty states for the rest.
3. Revenue-by-month and GST-by-period aggregation (below), which moved two more cards
   from "not tracked yet" to real numbers.

## 2. Files changed

**Added**
- `backend/src/staff/payments/accounting-overview.service.ts` — the aggregates
- `frontend/src/app/staff/accounting/dashboard/page.tsx` — route + role gate
- `frontend/src/components/staff/accounting/AccountingDashboardClient.tsx` — the page
- `frontend/src/components/staff/accounting/accounting-dashboard.css` — design tokens

**Modified**
- `backend/src/staff/payments/staff-finance.controller.ts` — one new route
- `backend/src/staff/payments/staff-payments.module.ts` — provider registration

**Added in the aggregation pass**
- `backend/src/staff/payments/accounting-overview.spec.ts` — 12 tests over the money
  arithmetic and the period boundaries

**Modified in the aggregation pass**
- `backend/src/staff/payments/accounting-overview.service.ts` — `revenueByMonth`,
  `gstByPeriod`
- `backend/src/contracts/contracts.service.ts` — writes `issuedAt` when an invoice is
  issued
- `frontend/src/components/staff/accounting/AccountingDashboardClient.tsx` — the two
  cards those fields feed

## 3. Database

**No schema change. No migration**, in either pass.

The aggregation pass looked like it needed one and did not: `Invoice.issuedAt` already
existed as a nullable column and was simply never written by anything. The fix was a
write-path change at the single place invoices are created, not a migration.

Existing invoices keep their null `issuedAt` — see §7 on why they are not backfilled.

## 4. Env vars

**None added.** The Google Fonts import (Nunito + Inter) is a stylesheet `@import`, not
configuration.

## 5. Third-party services

**None added.** `recharts` (^3.8.1) was already a dependency.

## 6. How to test

1. Sign in as OWNER, SUPER_ADMIN or FINANCE → `/staff/accounting/dashboard`.
2. `GET /staff/finance/accounting-overview` returns counts; compare against
   `SELECT status, COUNT(*) FROM invoices GROUP BY status` and the equivalent on
   `payments.verificationStatus`.
3. Sign in as any other staff role → redirected to `/staff`.
4. Set a rate on `/staff/finance`; the header chip and "Rate in force" follow it.

5. `GET /staff/finance/accounting-overview` returns `revenueByMonth` (six months,
   invoiced and received, split by currency, in minor units) and `gstByPeriod`.
6. `npx jest src/staff/payments/accounting-overview.spec.ts` covers the currency split,
   cancelled-invoice exclusion, the window edges, and the period boundaries.

Verified in production on the first deploy: 4 charts, 3 amber and 7 grey empty states,
no console errors, SUPPORT redirected to `/staff`. Production figures at the time:
1 PAID + 2 CANCELLED invoices, 5 PENDING / 2 CONFIRMED / 2 REJECTED payments, 6 cases
across six months, 2 exchange rates, 0 invoices carrying a locked rate.

After the aggregation pass: 6 charts, and the GST card explains its own zero — no
invoices issued in the current period, 3 older ones carrying no issue date.

## 7. Design decisions

**Two kinds of empty state, and they are not interchangeable.** "Nothing yet" (amber) is
the ordinary quiet of a young business and will fill in. "Not tracked yet" (grey) is a
gap in the software and will not, until someone builds it. Drawing a chart at zero would
claim the first when the truth is the second — a claim about the business rather than
about the code. Agent payables are the clearest case: `AffiliateAgent` has no rate, no
balance and no payout, so the card says that instead of showing `NZ$0.00`.

**One endpoint, returning facts only.** The spec named five endpoints, none of which
existed. They are one route now, because the page reads all of it together on one screen.
It returns counts — no colours, no labels, no copy. Which bucket is grey and which is
coral is a decision about meaning and belongs with the design tokens.

**FX falls back below three points.** Production holds two rates, two days apart, at the
same number. A line through them invites a conclusion about a trend that does not exist,
so below `FX_MIN_POINTS` the card shows the current rate, who set it and when. It switches
to the chart on its own. The y-domain is auto-scaled — the spec's fixed `[1.56, 1.68]` was
written for imagined data and would push the real rate off the chart.

**Cancelled invoices are grey, not coral.** An invoice withdrawn on purpose is not a
problem, and coral is reserved for the things that are — overdue, rejected, 60+ days.

**Money axes start at zero.** Recharts auto-domained the cash chart to start at 18k, which
hid the smaller series entirely and misstated every visible proportion. In a finance tool
that is not cosmetic.

**Revenue is returned per currency, never blended.** Invoices are USD, payments are NZD.
Combining them needs the rate each invoice was locked to, and that is null on every
invoice raised before the stamping existed. A single figure could only be produced by
re-rating history at today's number — silently changing amounts already reported — or by
quietly dropping the rows that cannot be converted. Per-currency is the only version that
can be traced back to what happened.

**Revenue dates invoices by `createdAt`; GST dates them by `issuedAt`.** A deliberate
asymmetry. Every invoice has a created date, so a revenue trend filtered on `issuedAt`
would silently understate months that genuinely had invoices in them. A GST return has to
be assessed on when the invoice was issued, and guessing that date would be worse than
admitting it is missing — so the period view counts undated invoices separately, as
`unassignedCount`, rather than dropping them or folding them into a period they were
never assessed in. A tax return and a trend line do not carry the same obligation about
which date is correct.

**GST periods are derived, not stored.** Calendar-aligned two-monthly blocks from a
`GST_PERIOD_MONTHS` constant — a property of the business, not of the file, so an entity
filing six-monthly changes one number. No period table until a filed period needs locking
(§9).

**Period boundaries are formatted from local date parts, not `toISOString()`.** The
boundaries are built as local midnight, and in New Zealand local midnight is the previous
day in UTC: a period starting 1 July reported itself as starting 30 June. An invoice
issued on the first day of a period would have been filed against the previous return.
Caught by a test, fixed with local formatting, and covered at 1 September and 1 January
so the class of bug is closed rather than the one instance.

**Money is minor units everywhere in the response.** `Invoice.amount` is Decimal dollars
and `Payment.amount` is integer cents; the endpoint normalises both to cents so no caller
has to know which it is holding.

**Two role names in the spec did not exist.** `FINANCE_ADMIN` is not in `UserRole`; the
gate is `OWNER, SUPER_ADMIN, FINANCE`, matching `/staff/commissions` and `/staff/finance`.

**Two pieces of spec copy were rendered from real counts instead of verbatim.** The FX
note ("4 USD invoices are locked to earlier rates") and the monthly-goal figures were
written against imagined data. Confirmed with the Owner before changing.

## 8. Security

- Page-level gate in a server component (`redirect('/staff')`), plus
  `@StaffRoles('OWNER','FINANCE')` on the endpoint — the browser check is convenience,
  the server check is the boundary.
- Read-only. No mutation, no write path, nothing user-supplied reaches a query.
- Returns aggregate counts only: no client names, no amounts, no case identifiers.
- Unauthenticated request to the endpoint returns 401 (verified in production).

## 9. Known limitations / backlog

**Done since the first pass:** revenue-by-month and GST-by-period, both shipped in the
aggregation pass.

Still deliberately not built. Each is its own piece of work, not unfinished business here.

1. **Service mix — its own future phase.** Not a query. There is no fee-type column:
   `Payment.paymentType` records how money arrived (manual / consultation), not what was
   sold, and the fee type survives only in the Stripe metadata blob — on 1 of 9 production
   payments. Manual payments never captured it, so nothing can be recovered
   retrospectively. Scope is a `feeType` column on `Payment`, capture on both the Stripe
   and manual write paths, and a fee-type selector in manual payment entry. Existing rows
   stay unclassified. Until then the card keeps its "not tracked yet" empty state.
2. **`GstReturnPeriod` table — deferred.** Derived arithmetic is enough while nothing
   needs locking. Worth revisiting the first time a return is actually filed, so a filed
   period's figures cannot shift afterwards.
3. **`issuedAt` on the three existing invoices stays null.** They predate the write path
   and belong to no return period. Backfilling would mean guessing a date on a tax
   record; `unassignedCount` surfaces them instead.
4. **Agent payables** — the largest. `AffiliateAgent` records attribution only. Rates,
   balances and payouts do not exist; the schema comment defers them to `PR-AFFILIATE-1`.
   Closer in size to the Commissions build than to a dashboard wiring pass.
5. **Provider commission** figures depend on commissions existing (0 in production today);
   the cards are wired to an empty state and will need real aggregation when they do.
6. **Money out** — the other half of "cash in vs cash out" is agent payouts, which item 4
   blocks. The card shows money received and says so.
7. **`paymentType` is not a payment method.** "How clients pay" shows manual /
   consultation / unknown, which is the nearest available field, not Stripe / link /
   transfer as the spec intended.

## 10. How to extend / rollback

**Extend.** Add fields to `AccountingOverview` and its service; the page reads them and
replaces an `<Empty>` with a chart. Keep the "facts only, no presentation" split. When a
card gains real data, delete its `<Empty>` — do not leave both behind a flag.

**Rollback.** Revert the aggregation commit for the two new fields, or `2490ed1` as well
to remove the route entirely. No migration to unwind and no configuration to undo. The
only lasting effect of the aggregation pass is that invoices issued after it carry an
`issuedAt` — reverting stops new ones being stamped but leaves existing values intact,
which is harmless: the column was nullable before and remains so.
