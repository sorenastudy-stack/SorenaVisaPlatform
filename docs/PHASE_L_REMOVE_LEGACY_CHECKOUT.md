# PHASE-L — Remove the caller-less legacy checkout endpoints

`POST /payments/subscription/checkout` and `POST /payments/consultation/checkout`
had zero callers and were legacy. This removes them and everything that became
dead with them, **without touching** the live paid-booking flow, the Stripe
webhook, or any database table.

## 1. What this PR does

- Deletes the two checkout endpoints and their now-dead dependency graph.
- Leaves the live paid-booking path (`POST /booking/checkout` +
  `createBookingCheckoutSession` + `createConsultationPaymentLink`), the Stripe
  webhook (all branches), the engagement-invoice flow, `SubscriptionsService`
  (webhook still uses it), and the `subscriptions` table entirely intact.

## 2. Scan (what's dead, what's not)

**Callers of the two endpoints:** none — frontend, backend, scripts, and config
(re-verified by grep; the only matches were code comments). No Stripe config
points at them (Stripe only calls `POST /payments/webhook`; the Stripe dashboard
isn't reachable from here, but these are inbound session-creators nothing external
targets).

**Dead-with-them (deleted):**
| Symbol | Why dead |
|---|---|
| `PaymentsController.createSubscriptionCheckout` / `createConsultationCheckout` | the endpoints themselves |
| `StripeService.createCheckoutSession` | only the subscription endpoint called it |
| `PaymentsService.resolveSubscriptionPrice` | only the subscription endpoint (PHASE-K) |
| `PaymentsService.assertLeadCheckoutAllowed` | only the two endpoints (PHASE-J) |
| `payments/subscription-config.ts` (file) | only the two symbols above used it |
| `SubscriptionsService.createSubscription` | only the subscription endpoint |
| unused `Throttle` + `Stripe` imports in the controller | only those endpoints |

**Deliberately KEPT (see §7):** `StripeService.createOneTimePayment`.

## 3. The `createOneTimePayment` discrepancy (reported, not overridden)

The task ring-fenced `createOneTimePayment` ("do NOT touch"). The scan shows it
is actually **only called by the removed `consultation/checkout` endpoint** — it
is NOT part of the LIA/GAP booking flow (that uses `createConsultationPaymentLink`
/ `createBookingCheckoutSession`). So with the endpoint gone, `createOneTimePayment`
is now **dead code**. Because the instruction to leave it was explicit, I **left
it** (with a comment noting it's now unreferenced) rather than override a "do NOT
touch". It is safe to delete in a follow-up — flagging for your call.

*(My PHASE-K note grouped it with the booking flow; that was imprecise. It was
only ever the `consultation/checkout` helper.)*

## 4. Database: nothing dropped, nothing orphaned

- **`Subscription` model / `subscriptions` table — NOT orphaned, NOT touched.**
  Still read/written by the live Stripe webhook (`customer.subscription.updated/
  deleted` → `handleSubscriptionUpdated/Deleted` → `expireSubscription`) and
  counted by `dashboard.service` (`subscription.count`). `SubscriptionsService`
  remains (only its `createSubscription` method went).
- No migration; no schema change; no table drop. (Per instruction — code removal
  only.)

## 5. Files changed

- `payments/payments.controller.ts` — two endpoints removed; unused `Throttle` +
  `Stripe` imports removed. Webhook + all other routes unchanged.
- `payments/payments.service.ts` — `resolveSubscriptionPrice` +
  `assertLeadCheckoutAllowed` + `CHECKOUT_STAFF_ROLES` + subscription-config /
  `ForbiddenException` imports removed. Other methods unchanged.
- `payments/stripe.service.ts` — `createCheckoutSession` + `PlanPrice` import
  removed. `createOneTimePayment` kept (now unreferenced, see §3).
- `payments/subscription-config.ts` — **deleted** (was created in PHASE-K).
- `subscriptions/subscriptions.service.ts` — `createSubscription` removed;
  `activateSubscription` / `expireSubscription` kept.
- **Tests (local-only, gitignored):** new `test-remove-legacy-checkout.ts`; the
  PHASE-J and PHASE-K test scripts had their now-obsolete checkout-ownership /
  amount-tampering sections retired (they exercised the deleted code).

## 6. How to test

- **`test-remove-legacy-checkout.ts` — 17/17, runtime** (reflection over the real
  classes): both checkout routes + their controller methods gone;
  `resolveSubscriptionPrice` / `assertLeadCheckoutAllowed` /
  `createCheckoutSession` / `createSubscription` gone; `subscription-config`
  module unresolvable; **kept**: `createBookingCheckoutSession`,
  `createConsultationPaymentLink`, `createOneTimePayment`, `activate/expire`,
  `handleWebhook` + `webhook` route, `POST /booking/checkout`, the portal invoice
  pay route, and the live payment-link routes; webhook `ACCOUNT_OPENING` /
  `booking` / `consultation` branches still present; no dangling references.
- **booking-webhook jest spec — 3/3 (runtime):** the LIA/GAP paid-booking confirm
  path (`confirmHeldBookingPayment`) + ACCOUNT_OPENING handling are exercised and
  pass — the flow proved in prod is unregressed.
- **Engagement invoice flow:** the `/portal/*` code was **not touched**; the pay
  route (`/portal/me/invoices/:invoiceId/pay-options`) is asserted present.
- `nest build` clean, no dangling imports.
- **Prior suites:** PHASE-I `test-endpoint-scoping` **24/24** unchanged. PHASE-J
  (`test-fail-closed-auth`) and PHASE-K (`test-staff-guard-and-amount`) had the
  sections that tested the now-deleted code retired; their remaining guard /
  scoping assertions still pass (PHASE-J 11/11, PHASE-K 10/10). This is expected —
  removing the endpoints necessarily retires the tests of the endpoints' logic;
  that coverage moved to the PHASE-L removal test.

## 7. Known limitations / follow-ups

- **`createOneTimePayment` is now dead** (§3) — kept only because it was
  explicitly ring-fenced. Remove it in a follow-up if confirmed unwanted.
- **The `subscriptions` domain is now write-only via Stripe webhook** — the app
  no longer *creates* subscriptions (no endpoint does). If subscriptions are a
  dead product line, a larger cleanup (service + table) is a separate, deliberate
  decision — not done here (tables are off-limits per the task).
- The `payment/success` + `payment/cancel` Stripe redirect URLs referenced only
  by the removed `createCheckoutSession` are gone with it; the booking flow uses
  its own success/cancel URLs (unchanged).

## 8. How to extend

- If subscriptions are revived: add a new, properly-scoped endpoint + a fresh
  server-derived price source (don't resurrect the deleted config verbatim — it
  was stale NZD; see PHASE-K §4).
- To finish the cleanup: delete `createOneTimePayment`, and (a separate call)
  decide the fate of `SubscriptionsService` + the `subscriptions` table.

## 9. Security applied

- **Attack surface reduced** — two authenticated-but-unscoped-by-design session
  creators are gone. (Their PHASE-J ownership guard + PHASE-K amount guard are
  removed *with* them — there is no longer an endpoint to protect.)
- **No behaviour change to any live money path** — booking checkout, the Stripe
  webhook (idempotent Payment.create, invoice reconciliation, LIA auto-assign,
  booking confirm), and the engagement-invoice flow are byte-for-byte unchanged.
- **No table dropped** — orphan analysis showed the `subscriptions` table is
  still live; it was left untouched.

## 10. Rollback procedure

- **Code:** revert the commit. The two endpoints, `createCheckoutSession`,
  `resolveSubscriptionPrice`, `assertLeadCheckoutAllowed`, `createSubscription`,
  and `subscription-config.ts` return. No schema/data to unwind.
- **No DB impact** — nothing was migrated or dropped.
- **Order:** backend-only; no frontend change (the endpoints had no callers).
  Deploy/rollback independently.
