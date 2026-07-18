# PHASE-K — StaffRolesGuard fail-closed + subscription amount server-derived

Two follow-ups from PHASE-J. (1) `StaffRolesGuard` — the sibling fail-open guard —
now fails closed. (2) `POST /payments/subscription/checkout` no longer trusts a
client-supplied price; the amount is derived server-side from the plan.

## 1. What this PR does

- **StaffRolesGuard fail-closed** — a route behind it with no `@StaffRoles`/
  `@OwnerOnly`/`@AdminTier` is now denied (was: allowed). Defers to `@Roles` if a
  route ever combines the two. Full per-route sweep first: **57 routes across 13
  controllers, all gated, zero flagged** → the flip is a no-op for live traffic.
- **Subscription amount server-derived** — the plan price is single-sourced in
  `subscription-config.ts` and resolved in the service. The client sends only the
  plan; a client-sent amount is used only to DETECT tampering — a mismatch is
  **audit-logged and rejected**. An unknown/forged plan is rejected (no fallback
  to a client amount). Currency is now config-driven (was hardcoded `'nzd'`).

## 2. The sweep (before → after)

### StaffRolesGuard
`staff-roles.guard.ts` returned `true` when `@StaffRoles` metadata was absent
(fail-open) — same pattern as the RolesGuard fixed in PHASE-J. It is applied on
**13 controllers** (`@UseGuards(JwtAuthGuard, StaffRolesGuard)` class-level on all).
Exhaustive per-route audit:

| # | Controller | Routes | Gated |
|---|---|---|---|
| 1 | staff-documents | 1 | ✓ (method) |
| 2 | assignments | 5 | ✓ |
| 3 | staff-bookings | 4 | ✓ |
| 4 | staff-cases | 5 | ✓ |
| 5 | staff-hr-admin | 6 | ✓ |
| 6 | staff-hr | 3 | ✓ |
| 7 | staff-leave | 3 | ✓ |
| 8 | staff-me | 1 | ✓ (method) |
| 9 | owner-approval | 5 | ✓ |
| 10 | staff-finance | 2 | ✓ |
| 11 | staff-payments | 4 | ✓ |
| 12 | **team** | 9 | ✓ (class-level `@AdminTier()`) |
| 13 | staff-users | 9 | ✓ |

**Total 57 routes, 0 flagged.** None also use the plain `RolesGuard`; all have
`JwtAuthGuard` upstream. A runtime reflection test re-verifies all 57 (see §6).

### Subscription amount / currency
`stripe.service.createCheckoutSession` had `const amount = prices[plan] ||
amountNZD * 100` — for a KNOWN plan the server price won; but an **unknown/forged
`plan` string** (the DTO isn't runtime-validated) hit the client `amountNZD`.
Currency was **hardcoded `'nzd'`** — stale vs the USD session-pricing work
(`booking/session-config.ts` uses USD). The endpoint has **no callers** today.

## 3. Files changed

- `staff/roles/staff-roles.guard.ts` — fail-closed + `@Roles` deferral.
- `payments/subscription-config.ts` — **new** single-source plan pricing.
- `payments/payments.service.ts` — `resolveSubscriptionPrice(plan, amount?, actor)`
  (server price + tamper detect/reject/audit).
- `payments/payments.controller.ts` — subscription checkout resolves the price
  server-side and passes it through.
- `payments/stripe.service.ts` — `createCheckoutSession(leadId, plan, price)` uses
  the server-derived amount + config currency; internal price map + client
  fallback removed.
- **Test (local-only, gitignored):** `backend/scripts/test-staff-guard-and-amount.ts`.

## 4. Currency finding (reported)

The subscription amounts are **stale NZD** (BASIC 2999 / PRO 4999 / PREMIUM 9999
cents), inconsistent with the USD session-pricing single-source. Because the
endpoint has **no callers**, this PR preserves the amounts verbatim (relabelling
to USD would change what a customer is charged) and makes `currency` explicit in
`subscription-config.ts` so the product decision is a one-line change per plan.
**Recommendation:** decide currency + amounts before subscriptions ship; ideally
fold subscription pricing into the same USD config approach as sessions.

## 5. Configuration

None. No env/schema/migration. Tamper attempts reuse `AuditLog`
(`PAYMENT_AMOUNT_TAMPER_ATTEMPT`). Plan pricing lives in `subscription-config.ts`.

## 6. How to test

`scripts/test-staff-guard-and-amount.ts` — **17/17, runtime**:
- **Guard:** no @StaffRoles + no @Roles → denied; no @StaffRoles + @Roles →
  allowed (defers); @StaffRoles + role in set + active → allowed; role not in set
  → denied; deactivated → denied.
- **Coverage (reflection over the real controllers):** all **57** staff routes
  carry role metadata → 0 ungated (the flip can't 403 a real route).
- **Real guard:** TeamController (`@AdminTier`) admits ADMIN, denies STUDENT;
  StaffMeController (`@StaffRoles`) admits its intended role.
- **Amount:** plan-only → server price; correct amount accepted; **tampered
  amount rejected + audited**; forged plan rejected; only the tamper audits; and
  **Stripe receives the server `unit_amount`/currency**, not a client value.
- **Public/booking:** Auth, ShortLink, Booking use no StaffRolesGuard.

Regression: PHASE-J `test-fail-closed-auth` and PHASE-I `test-endpoint-scoping`
still pass; **booking webhook spec 3/3** (the LIA/GAP paid-booking flow is
untouched — `createConsultationPaymentLink` / `createOneTimePayment` / the webhook
branches were not changed). `nest build` clean. (The payments.controller DB
integration spec remains a pre-existing fixture flake, as in PHASE-J.)

## 7. Known limitations / follow-ups

- **Subscription currency decision** (see §4) — stale NZD, no callers; product to
  decide before it ships.
- **Consultation checkout** (`/consultation/checkout`) uses a server-hardcoded
  amount (`{ADMISSION:50, LIA:200}` in the controller) — not client-tamperable,
  but its currency is likewise stale NZD; same decision applies when/if it ships.
- The subscription/consultation checkout endpoints remain **caller-less** (legacy).
  If they are truly dead, consider removing them rather than maintaining them.

## 8. How to extend

- Change a plan price/currency: edit `SUBSCRIPTION_PLANS` in
  `payments/subscription-config.ts` — the only place amounts live.
- Add a plan: add a key to `SUBSCRIPTION_PLANS`; `getPlanPrice` and the resolver
  pick it up; unknown plans are rejected by default.

## 9. Security applied

- **Fail-closed by default** — both role guards (RolesGuard in PHASE-J,
  StaffRolesGuard here) now deny an un-decorated route instead of allowing all.
- **Service-layer enforcement** — the plan→price resolution and tamper rejection
  live in `PaymentsService`; the controller cannot charge a client-chosen amount.
- **No client-sent price trusted** — the amount is derived from the plan via
  config; a submitted amount is only compared, never used to charge.
- **Audit** — a price mismatch writes `PAYMENT_AMOUNT_TAMPER_ATTEMPT` with the
  submitted vs server amount and the actor snapshot (money).
- **Deferral safety net** — each guard defers to the other's decorator if a route
  ever carries both, so neither guard can lock out a route the other authorizes.

## 10. Rollback procedure

- **Code:** revert the commit. `staff-roles.guard.ts` returns to fail-open; the
  subscription checkout returns to trusting `amountNZD`. No schema/data to unwind.
- **Guard note:** if the fail-closed flip ever denies a legitimate route (a
  straggler the sweep missed), fix forward by adding the missing `@StaffRoles` —
  do **not** revert the guard (that re-opens the hole). The sweep found zero.
- **Order:** backend-only; no frontend change. Deploy/rollback independently.
