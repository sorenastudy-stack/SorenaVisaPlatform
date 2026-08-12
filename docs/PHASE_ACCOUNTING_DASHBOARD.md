# Phase — Accounting Dashboard

> **This phase is COMPLETE. This is its final update.**
> The Accounting Dashboard and the whole Agent Payables feature — derivation
> (phase 1) and the approve/release workflow (phase 2) — are built, deployed
> and verified end to end. Later work on agent payouts should start its own
> phase document rather than extend this one. The open items in §9 are
> deliberate exclusions, not unfinished business.

**Date:** 12 August 2026
**Commits:** `2490ed1` (dashboard) · `74e0e9b` (revenue + GST aggregation) ·
`c5ac865` (provider commission + agent payables phase 1) ·
`befea48` + `ed64340` (stale copy found by the populated verification, §6) ·
`3bf879f` (agent payables phase 2 — approve, reject, release)
**Route:** `/staff/accounting/dashboard`

## 1. What this does

A front page for the company accountant: the state of the money at a glance, above the
read-only reporting screens that already exist. Built from a complete external design
spec (design system, 16 charts, all copy), adapted where the spec described data the
platform does not have.

Ten of the sixteen cards carry real figures — payments by status, payments by type,
invoices by status, students per month, money received by month, GST for the current
return period, the provider commission pipeline and its ageing, and the two agent
payable cards — plus the exchange rate. **The rest say so rather than drawing a zero.**
That is the substance of this phase: the dashboard tells the truth about how much the
platform currently knows.

Built in passes, each reviewed before the next:

1. Layout against the design spec's example figures.
2. Wiring to what the platform actually records, with honest empty states for the rest.
3. Revenue-by-month and GST-by-period aggregation.
4. Provider commission wiring, and **Agent Payables phase 1** — a new feature, not a
   wiring gap: agents had no money fields at all until this pass.
5. **Agent Payables phase 2** (§11) — approve, reject and release, under dual control.

Every card now reads from real data or says plainly why it cannot. The only remaining
"not tracked yet" is service mix (§9).

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

**Added in the provider-commission + agent-payables pass**
- `backend/prisma/migrations/20260812200000_agent_payables/` — enum + table, additive
- `backend/src/commissions/agent-payables.service.ts` — the rate, the derivation, the ledger
- `backend/src/commissions/agent-payables.controller.ts` — two read-only routes
- `backend/src/commissions/agent-payables.spec.ts` — 15 tests over derivation and access

**Modified in that pass**
- `backend/prisma/schema.prisma` — `AgentPayableStatus`, `AgentPayable`, two back-relations
- `backend/src/commissions/commissions.module.ts` — registration
- `backend/src/staff/payments/accounting-overview.service.ts` — `providerCommission`
- `backend/src/staff/payments/accounting-overview.spec.ts` — 9 tests over pipeline + ageing
- `frontend/src/components/staff/accounting/AccountingDashboardClient.tsx` — the four
  cards in the Provider commission and Agents sections

**Added in phase 2** (`3bf879f`)
- `backend/prisma/migrations/20260812210000_agent_payable_rejected_enum/` — the enum value
- `backend/prisma/migrations/20260812210100_agent_payable_rejection/` — columns + the partial unique
  index that replaces the outright one
- `backend/src/commissions/dto/reject-payable.dto.ts` — the reason, required
- `backend/src/commissions/agent-payables-decisions.spec.ts` — 19 tests over dual
  control, concurrency, rejection and audit
- `frontend/src/components/staff/commissions/AgentPayoutsClient.tsx` — both queues
- `frontend/src/app/staff/agent-payouts/page.tsx` + `release/page.tsx` — the two routes

**Modified in phase 2**
- `backend/src/commissions/agent-payables.service.ts` — the four transitions
- `backend/src/commissions/agent-payables.controller.ts` — six routes
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — nav entries in BOTH nav
  tables, and the first per-item count badge

**Modified by the two follow-up fixes**
- `frontend/src/components/staff/accounting/AccountingDashboardClient.tsx` — three KPI
  cards read from data instead of asserting an absence; the money-out note; the greeting
- `frontend/src/app/staff/accounting/dashboard/page.tsx` — stopped passing a name the
  session cannot supply

## 3. Database

**One additive migration**, in the agent-payables pass:
`20260812200000_agent_payables` — the `AgentPayableStatus` enum and the `agent_payables`
table, with `commissionId` UNIQUE. Nothing dropped, re-typed or rewritten, so unlike the
commission re-anchor there is no destructive step to guard.

**No schema change** in the first three passes.

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

After the aggregation pass: 6 charts, and the GST card explains its own zero.

7. `GET /staff/agent-payables` and `/staff/agent-payables/summary` — OWNER, SUPER_ADMIN,
   FINANCE. Both empty on production until a commission exists on an introduced lead.
8. `npx jest src/commissions/agent-payables.spec.ts` and
   `src/staff/payments/accounting-overview.spec.ts`.

Proven on demo with a fixture chain — one agent, three commissions (NZ$4,600 invoiced 12
days ago, NZ$5,100 at 50 days, NZ$8,400 paid):

```
Pipeline : 3 earned NZ$18,100 · 3 invoiced · 1 received NZ$8,400
Ageing   : 0-30 → 1 (NZ$4,600) · 46-60 → 1 (NZ$5,100)   the paid one stops ageing
Payables : NZ$840 / NZ$510 / NZ$460 — exactly 10% of each, all PENDING
Summary  : owed NZ$1,810.00, paid NZ$0.00, across 3 commissions
```

### Verified against populated data — and what that caught

Production could only ever exercise the empty branch: 0 commissions, 0 attributed leads.
The populated branch was proven on demo with the fixture chain above, on the deployed
demo frontend, and doing so found **six defects that an empty page hid completely**.

They were all one bug: **a hardcoded string written when the feature did not exist,
still asserting its absence after it shipped.** Against empty data such a string is
indistinguishable from an honest empty state — it reads as correct, renders no error,
and passes every test, because nothing in it is wrong until there is data to contradict
it. Against populated data it sat directly above a chart proving it false.

| Round | Found | Why the previous round missed it |
|---|---|---|
| 1 — production, empty | "Commission payable — agent payouts aren't tracked yet"; "nothing records them"; "approved amounts need a second person"; greeted every reader as *Leila*, "Good morning" at any hour | Only visible by reading the rendered page. Tests and `tsc` cannot know a true sentence became false. |
| 2 — demo, populated | "Not totalled by month yet" above a populated revenue chart; "No commissions recorded yet" above a pipeline showing three; the greeting printed an **email** | Both KPIs looked like correct empty states while the data was empty. |
| 3 — demo, populated | Nothing. All four KPI cards, both new sections and the greeting read true. | — |

Two lessons worth keeping:

- **"No console errors" is not "correct".** Every one of these rendered cleanly. The
  check that found them was reading the words on the page against the numbers beside
  them.
- **A fix needs the same verification as a feature.** Round 1's greeting fix read the
  name from the session; the JWT carries `sub`, `email`, `role` and `secondaryRoles` and
  no name, so `getSession` falls back to the email. It replaced greeting the wrong person
  with greeting them by their login — and only a populated screenshot showed it, while the
  header two inches above had been correct all along by reading `/api/staff/me`.

## 7. Design decisions

**Two kinds of empty state, and they are not interchangeable.** "Nothing yet" (amber) is
the ordinary quiet of a young business and will fill in. "Not tracked yet" (grey) is a
gap in the software and will not, until someone builds it. Drawing a chart at zero would
claim the first when the truth is the second — a claim about the business rather than
about the code. Agent payables were the clearest case: while `AffiliateAgent` had no rate,
no balance and no payout, the card said so instead of showing `NZ$0.00`. Building the
feature is what changed it from grey to amber — the card now says "nothing yet", which is
true, because the derivation runs and finds no attributed commissions.

**A figure and the chart beside it are derived once, not twice.** Commission receivable is
summed from the ageing buckets rather than recomputed from the pipeline: invoiced-and-not-
yet-received is precisely what those buckets hold, and a second derivation is a second
thing that can quietly drift out of step with the picture next to it. On the demo chain
the KPI reads NZ$9,700 and the two unpaid buckets read NZ$4,600 and NZ$5,100 — they agree
because they cannot disagree.

**Copy that asserts an absence is a maintenance liability.** Every "isn't tracked yet"
string is a claim that expires the moment someone builds the thing. Where a card can read
its own emptiness from data — no rows, no currencies, a zero count — it says so from the
data and cannot go stale. Where a string is unavoidable, it belongs next to the code that
would make it false.

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

**The provider pipeline is derived from timestamps, not from status.** `invoiceSentAt`
and `paidAt` are facts about what happened; `status` is a label that can drift out of step
with them. The three stages are **nested, not exclusive** — a received commission is also
invoiced and also earned — which is what makes the bars read as one funnel rather than
three unrelated groups.

**An unpriced commission is counted separately, never as zero.** A commission with neither
an actual nor an estimated amount goes to `unpricedCount` and is excluded from every
total. Adding it as zero would read as "worth nothing" when the truth is "not yet priced"
— the same trap as drawing an empty chart for an unbuilt feature.

**Ageing bucket edges are inclusive.** A commission invoiced exactly 30 days ago sits in
0–30, not 31–45. And 60+ keeps coral: an old unpaid commission is a problem, and problems
do not lose their colour.

**The pipeline is coloured by stage, not by series.** First rendered with one colour per
currency, which made all three bars identical when there is only one currency — caught in
a screenshot and corrected to sun → sky → teal, so each stage keeps its meaning from the
palette.

**Agent payables are derived, never asserted.** There is no "submit" step, because there
is nobody to submit: the amount falls out of a commission Sorena has already earned, so a
human claiming it would only be retyping arithmetic. That also fixes the risk shape — a
share of money already earned means Sorena cannot owe an agent for a lead that never
enrolled or never paid.

**`amount` and `ratePercent` are snapshots, never recomputed.** The same principle as an
invoice's locked exchange rate: changing the company rate must not silently restate what
an agent has already been told they are owed, still less what has already been paid. A
test proves an existing payable survives a rate change untouched.

**The rate lives in one findable place.** `AGENT_COMMISSION_RATE_PERCENT` in
`agent-payables.service.ts`, exported and named rather than written inline. Per-agent
override is a plausible extension — the snapshot exists precisely so introducing one later
cannot rewrite history — but nothing reads a per-agent field today.

**Derivation runs on read, not on a schedule.** Idempotent and insert-only: `commissionId`
is unique, so a second run creates nothing. A nightly job would leave a window where a
commission exists and its payable does not, and would need backfilling whenever it missed.

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

**Done since the first pass:** revenue-by-month, GST-by-period, provider commission
pipeline and ageing, and agent payables phase 1.

**Agent payables phase 2 — built and shipped.** See §11.

**Cleanup — done.** Production held two placeholder `AffiliateAgent` rows: one named
`jacki` with notes `"test"`, and one carrying the Owner's own email. Both were deleted on
12 August 2026, before the payout workflow existed, so there was never a moment where a
real Pay button sat beside a test record. Neither carried an attributed lead or a payable;
`jacki`'s single tracking link had zero clicks and was removed with it. A full verified
`pg_dump` and a row-level JSON snapshot were taken first, and the deletion is in the audit
log as `AFFILIATE_AGENT_DELETED` — written afterwards, because the maintenance script that
performed it bypassed the app's own delete path, which would have written it.

**⚠ `FINANCE_TABS` says one thing and does another.** In
`frontend/src/components/staff/shell/StaffBottomTabs.tsx` the comment states its labels
are "rendered directly, not via t()" while the code calls `t(tab.label)` on them, so a
FINANCE user gets four `MISSING_MESSAGE` console errors on every page load. Harmless but
noisy, and it is the same stale-comment class as the copy bugs in §6 — a comment that was
true when written and silently became false. A five-minute fix: mirror the sidebar's
`label.includes('.') ? t(label) : label`. Left out of the phase-2 push on purpose, to keep
that change to one subject.

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
4. **Money out** — the other half of "cash in vs cash out". Agent payables now exist and
   carry an amount, but nothing has been *paid* until phase 2 ships, so there is still no
   outgoing figure to plot. The card shows money received and says so.
5. **The rate is one number for every agent.** No per-agent override, no tiering, no
   minimum. The snapshot on each payable is what makes adding one later safe.
6. **Both new sections stand on production data that does not exist yet** — 0 commissions
   and 0 attributed leads today. The derivation is proven on demo fixtures (§6); the
   production cards correctly show "nothing yet" rather than zeros.
7. **`paymentType` is not a payment method.** "How clients pay" shows manual /
   consultation / unknown, which is the nearest available field, not Stripe / link /
   transfer as the spec intended.

## 11. Agent Payables phase 2 — approve, reject, release

Shipped in `3bf879f`. Phase 1 worked out what is owed; this decides whether to pay it,
and records who said so.

### The control, and why it is the whole point

```
PENDING  --approve--> APPROVED  --release--> PAID     FINANCE approves, OWNER releases
   |
   +-----reject-----> REJECTED  (terminal, reason required)
```

`release()` refuses when `approvedById === actor.id`. **That single check is the
feature.** Without it the two states are paperwork: one person holding the right role
walks a payable from PENDING to PAID alone, and nothing on the way out disagrees. It is
copied from the one place in this codebase that already enforces separation of duties —
`OwnerApprovalService.approve()` — but the question is different there. A refund has a
requester; a payable has none, because it is derived precisely so that nobody claims it.
So the pairing that matters is approver-versus-releaser, not requester-versus-approver.

A refused self-release is **written to the audit log**, not merely rejected. One person
attempting both halves is exactly the event the control exists to catch, and an attempt
nobody can see afterwards is a control that only works while somebody is watching.

### Endpoints

| Route | Role | Transition |
|---|---|---|
| `GET /staff/agent-payables/pending` | FINANCE (+OWNER/SUPER_ADMIN) | — |
| `GET /staff/agent-payables/awaiting-release` | money tier | — |
| `GET /staff/agent-payables/awaiting-release/count` | money tier | — (the badge) |
| `PATCH /staff/agent-payables/:id/approve` | FINANCE (+OWNER/SUPER_ADMIN) | PENDING → APPROVED |
| `PATCH /staff/agent-payables/:id/reject` | FINANCE (+OWNER/SUPER_ADMIN) | PENDING → REJECTED |
| `PATCH /staff/agent-payables/:id/release` | **OWNER only** | APPROVED → PAID |

The role gate says who may ask; the service decides what happens. `release` is OWNER-only
*and* refuses a self-release, and only the second of those is a rule about money.

### Transitions are conditional updates

`updateMany({ where: { id, status: from } })` with an asserted count of 1 — never
read-then-check-then-write. The owner-approval queue reads, checks, then writes, and
survives concurrency only because Stripe deduplicates on an idempotency key. **A payout
has no such backstop**, so the database has to be the thing that says no. Proven with two
simultaneous releases producing exactly one payment and one refusal — in tests, over local
HTTP, and against production.

### The bug that nearly shipped: a rejection that undid itself

The constraint was narrowed from "one payable per commission" to "one LIVE payable per
commission" (partial unique index, the same shape as
`commission_triggers_one_live_per_choice`) so that a refusal stays on record without
condemning the commission to never producing a payable again.

But derivation runs on every read. The first build did exactly what the constraint now
permitted:

```
REJECTED   510   reason=provider clawed the commission back
PENDING    510   <- back in Finance's queue within one second
```

Finance would reject the same row forever. **A reject button that undoes itself is worse
than no reject button.** The fix separates the constraint from the behaviour: the index
still permits a replacement, so raising one later needs no migration, but the derivation
skips any commission that has ever had a payable (`agentPayables: { none: {} }`). Raising
a fresh payable after a refusal is a decision somebody takes — and **that action is not
built**, so today a rejection is final in practice.

Only a click-through found this. Every test passed, because the tests asserted the
behaviour that had been asked for.

### Two migration folders, on purpose

`20260812210000_agent_payable_rejected_enum` adds `REJECTED`;
`20260812210100_agent_payable_rejection` adds the four rejection columns and swaps the
index. They cannot be one file: Postgres permits `ALTER TYPE ... ADD VALUE` inside a
transaction but forbids *using* the new value in that same transaction, and the partial
index's predicate names it. `prisma migrate deploy` wraps each file in a transaction, so a
single migration fails with "unsafe use of new value of enum type". Confirmed applying in
order on production — enum committed first, index second.

### Rejection requires a reason

Unlike the refund queue's optional `decisionNote`. This is money owed to somebody outside
the company, and the question a reconciliation asks months later is "why was this not
paid?" — a blank answer makes the row unexplainable rather than merely undocumented.
Enforced in the DTO and re-checked, trimmed, in the service.

### Audit trail

`AGENT_PAYABLE_APPROVED` / `_REJECTED` / `_PAID`, plus `_APPROVE_REFUSED` /
`_REJECT_REFUSED` / `_RELEASE_REFUSED` for attempts that failed. Every row carries the
**amount and currency** in its payload — correcting the refund precedent, where
`OWNER_APPROVAL_EXECUTED` records that something happened but not what moved, and where a
failed execution writes no audit row at all.

Actor names are read from the **database**, not the token. The JWT carries `sub`, `email`,
`role` and `secondaryRoles` and no name, so a snapshot taken from `req.user.name` would
have written null on every decision — and a null snapshot is worthless the moment the
staff row it was supposed to outlive is deleted. Same root cause as the greeting bug in
§6, caught the second time by remembering the first.

### UI

Two pages, one component (`AgentPayoutsClient`, `mode="approve" | "release"`), modelled on
`CommissionTriggersClient`'s two-role queue rather than the refund queue's encrypted
payload renderers. A payout the viewer approved themselves renders **greyed out with the
reason in amber** — the server would refuse it anyway, but a button that fails when
pressed teaches nothing.

The count badge needed a new mechanism: the only badge in the shell belonged to the
notification bell and could not carry a queue depth. `NavItem.badge` is a named key so the
nav table stays a static declaration. **FINANCE has its own fixed nav** (`FINANCE_NAV`),
not the role-filtered one, so an entry added only to `NAV` would have been invisible to
the role that does the approving — both lists carry it.

The badge matters more than it looks: unlike a refund request, **a payable never expires**.
Nothing eventually notices an unnoticed one.

### Verified

- 1,145 tests / 95 suites, 21 new. Mutation-tested: removing the self-release check fails
  2 tests; removing `status` from the conditional update fails both concurrency tests.
- 36/36 over local HTTP against a running backend.
- 23/23 against **production**, including the concurrency guard and the self-release block,
  with fixtures torn down to a verified residual of zero.
- Click-through on demo: both queues, the badge, and the greyed-out self-approved row,
  with no console errors on either page.

### ⚠ `nest build` can silently do nothing

`tsconfig.json` sets `incremental: true` and `nest-cli.json` sets `deleteOutDir: true`.
The tsbuildinfo file survives the deleted `dist/`, so tsc concludes the outputs are
current and emits **nothing** — while `nest build` exits 0. A stale or absent `dist` then
boots the *previous* code, which is how a "clean build" can be reported for a build that
never ran.

Trust `npx tsc --noEmit` for correctness, and when the compiled output matters (running
`dist/main`, deploying), delete `tsconfig.build.tsbuildinfo` first and check that `dist/`
actually has ~62 entries. Some "build clean" claims made earlier on 12 August 2026 were
weaker than they sounded for this reason.

## 10. How to extend / rollback

**Extend.** Add fields to `AccountingOverview` and its service; the page reads them and
replaces an `<Empty>` with a chart. Keep the "facts only, no presentation" split. When a
card gains real data, delete its `<Empty>` — do not leave both behind a flag.

**Rollback (phase 2).** Reverting the code leaves the four rejection columns and the
partial index in place, which is harmless — but note the index is the ONLY thing stopping
two live payables per commission, since phase 2 replaced the outright unique constraint.
Do not drop it without restoring `agent_payables_commissionId_key` in the same breath. Any
payable already APPROVED or PAID carries a human decision and must never be discarded to
simplify a rollback.

**Rollback.** Revert per pass. The aggregation pass has no migration to unwind; its only
lasting effect is that invoices issued after it carry an `issuedAt`, and reverting simply
stops new ones being stamped — the column was nullable before and remains so.

The agent-payables pass added a table. Reverting the code leaves `agent_payables` in place
and unused, which is harmless and is the safer order: drop the table only after the code
that reads it is gone, and only if the rows in it are not wanted. `AgentPayable` rows are
derived, so they can be rebuilt by running the sync again — but any that phase 2 has
approved or paid carry a human decision and must not be discarded to save a migration.
