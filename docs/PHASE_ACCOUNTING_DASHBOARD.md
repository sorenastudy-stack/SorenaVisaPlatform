# Phase — Accounting Dashboard

**Date:** 12 August 2026
**Commit:** `2490ed1`
**Route:** `/staff/accounting/dashboard`

## 1. What this does

A front page for the company accountant: the state of the money at a glance, above the
read-only reporting screens that already exist. Built from a complete external design
spec (design system, 16 charts, all copy), adapted where the spec described data the
platform does not have.

Four of the sixteen cards carry real figures today — payments by status, payments by
type, invoices by status, and students per month — plus the exchange rate. **The other
twelve say so rather than drawing a zero.** That is the substance of this phase: the
dashboard tells the truth about how much the platform currently knows.

## 2. Files changed

**Added**
- `backend/src/staff/payments/accounting-overview.service.ts` — the aggregates
- `frontend/src/app/staff/accounting/dashboard/page.tsx` — route + role gate
- `frontend/src/components/staff/accounting/AccountingDashboardClient.tsx` — the page
- `frontend/src/components/staff/accounting/accounting-dashboard.css` — design tokens

**Modified**
- `backend/src/staff/payments/staff-finance.controller.ts` — one new route
- `backend/src/staff/payments/staff-payments.module.ts` — provider registration

## 3. Database

**No schema change. No migration.** Every query is a read against existing tables
(`Invoice`, `Payment`, `Case`, `ExchangeRate`).

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

Verified in production on deploy: 4 charts rendered, 3 amber and 7 grey empty states,
no console errors, SUPPORT redirected to `/staff`. Production figures at the time:
1 PAID + 2 CANCELLED invoices, 5 PENDING / 2 CONFIRMED / 2 REJECTED payments,
6 cases across six months, 2 exchange rates, 0 invoices carrying a locked rate.

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

Deliberately not built. Each is its own piece of work, not unfinished business here.

1. **Revenue aggregation by month** — nothing totals revenue by period. Blocks the hero
   figure, cash in/out, the growth badge and the invoiced KPI.
2. **Service-mix aggregation** — needs each payment to carry the fee type it was charged
   under before revenue can be split by service.
3. **GST aggregation + a return period** — each invoice stores its own GST; nothing sums
   them, and no return period is configured.
4. **Agent payables** — the largest. `AffiliateAgent` records attribution only. Rates,
   balances and payouts do not exist; the schema comment defers them to `PR-AFFILIATE-1`.
   Closer in size to the Commissions build than to a dashboard wiring pass.
5. **Provider commission** figures depend on commissions existing (0 in production today);
   the cards are wired to an empty state and will need real aggregation when they do.
6. **`paymentType` is not a payment method.** "How clients pay" shows manual /
   consultation / unknown, which is the nearest available field, not Stripe / link /
   transfer as the spec intended.

## 10. How to extend / rollback

**Extend.** Add fields to `AccountingOverview` and its service; the page reads them and
replaces an `<Empty>` with a chart. Keep the "facts only, no presentation" split. When a
card gains real data, delete its `<Empty>` — do not leave both behind a flag.

**Rollback.** `git revert 2490ed1`. No migration to unwind, no data written, no
configuration to undo. The two modified backend files revert cleanly; the four added
files disappear with the route. Nothing else reads the new endpoint.
