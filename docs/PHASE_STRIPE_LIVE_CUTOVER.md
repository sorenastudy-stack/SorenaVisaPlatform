# Phase: Stripe Live Cutover & Payments

_Last updated: 25 Jun 2026_

## 1. What this phase does
Switches the platform's payments from Stripe test mode to live mode and makes the full payment chain work end to end: a client pays via a Stripe-hosted link, Stripe notifies the backend by webhook, and the payment is recorded against the correct case and enters finance review. It also adds a custom-amount payment link option and fixes the post-payment confirmation page.

## 2. Files created or changed
- `backend/src/main.ts` — added `rawBody: true` to `NestFactory.create` so Stripe webhook signature verification receives the raw request bytes.
- `backend/src/payments/stripe.service.ts` — (a) added `payment_intent_data: { metadata }` to the consultation payment-link creation so case metadata reaches the PaymentIntent; (b) added `createCustomAmountPaymentLink()` using inline `price_data` for arbitrary amounts.
- `backend/src/payments/payments.service.ts` — added `createCustomLinkForCase()` (resolves leadId from caseId, delegates to Stripe service).
- `backend/src/payments/payments.controller.ts` — added `POST /payments/case/:caseId/custom-link` route (staff roles only).
- `backend/src/payments/dto/create-case-custom-link.dto.ts` — new DTO validating the custom amount (integer cents, max 1,000,000 = NZD 10,000).
- `backend/src/payments/payments.service.spec.ts` — added 3 tests for the custom-link service method.
- `frontend/src/app/payment/success/page.tsx` — new payment confirmation page (fixes the post-payment 404); link points to `/portal` ("Go to my portal").
- `frontend/src/components/cases/CasePaymentsPanel.tsx` — added the "Custom-amount link" button and form.
- `frontend/src/i18n/messages/en.json` and `fa.json` — added i18n keys for the custom-amount link UI (English + Persian).

## 3. Database tables/columns added
None. Existing `Payment` table used. Idempotency relies on the existing `stripePaymentIntentId @unique` column.

## 4. Environment variables
No new variables. Uses existing `STRIPE_SECRET_KEY` (sk_live_…) and `STRIPE_WEBHOOK_SECRET` (whsec_… live), both stored in Railway.

## 5. Third-party services connected
- **Stripe (live mode).** Account used for production is the "Sorena Visa / WIX.com" Stripe account (secret key ends `ibqW`). Payouts go to Kiwibank ending 8001. Live webhook endpoint "Sorena production backend" → `https://sorenavisaplatform-production.up.railway.app/payments/webhook`, listening to `payment_intent.succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`. Managed in the Stripe Dashboard (Workbench → Webhooks).

## 6. How to test it works
1. Staff portal → a case → Payments tab → "Create payment link" (fixed price) OR "Custom-amount link" (type an amount).
2. Open the generated `buy.stripe.com/...` link, pay with a real card (small amount).
3. After paying you land on the `/payment/success` page ("Payment received").
4. In Stripe → Webhooks → "Sorena production backend" → Event deliveries, the `payment_intent.succeeded` event returns 201 with `{ "received": true }`.
5. Back on the case → Payments tab, the payment appears tagged "Stripe", status "Awaiting finance review".

## 7. Known limitations
- Custom-amount links are capped at NZD 10,000.
- Each non-ACCOUNT_OPENING payment produces one "failed then succeeded" entry in the Stripe webhook log (the handler attempts a subscription activation that doesn't exist, errors, Stripe retries, the retry hits the unique constraint and returns 200). The payment still records correctly; this is cosmetic log noise only.
- Payment confirmation emails to clients DO NOT send yet — blocked on the email/DNS migration (see the DNS doc).
- Payment links generated before a fix deploys cannot be retroactively fixed; generate a fresh link after deploys.
- The legacy `createCheckoutSession` / `createOneTimePayment` flows still have the old metadata-only pattern and a missing `/payment/cancel` page; they are not the production path and were left untouched.

## 8. How a future developer would extend this
- To change/raise the custom-amount cap: edit the `@Max` in `create-case-custom-link.dto.ts` and the client-side check in `CasePaymentsPanel.tsx`.
- To add new event handling: extend `handleWebhook` in `payments.controller.ts` and subscribe the new event in the Stripe webhook dashboard.
- To clean up the webhook log noise: add an `else if` branch (or a subscription-required flag) so non-subscription payments don't call `activateSubscription`.

## 9. Security layers applied
- Layer 3 (secrets in env): both Stripe keys live only in Railway env vars, never in code.
- Layer 4 (HTTPS): webhook endpoint is HTTPS (Railway default).
- Stripe webhook signature verification (raw-body fix) ensures only genuine Stripe events are processed.
- Layer 5 (rate limiting): the webhook route uses `@SkipThrottle()` deliberately so Stripe retries are never rate-limited; all other payment routes keep throttling.
- Role-gating: the custom-link route is restricted to staff roles (OWNER, SUPER_ADMIN, ADMIN, LIA, CONSULTANT, SUPPORT, FINANCE).

## 10. Rollback instructions
- Revert commits `945dc4d` (raw-body), `f751833` (metadata), `c8f5c0a` (success page), `57851e6` (portal link), `e1ff34d` (custom-amount) as needed; push to `main`; Railway + Vercel auto-redeploy.
- To pause live payments without code changes: disable or delete the "Sorena production backend" webhook in the Stripe live dashboard (payments still succeed in Stripe but won't record in-app) — or switch the Stripe keys in Railway back to test keys.
