# PR-SESSION-PRICING-USD — single-sourced USD session pricing + disclosed 10% card fee

Session prices move to **USD** (GAP $20, LIA $58, FREE $0), single-sourced from
`session-config`, with a **disclosed 10% card processing fee** (card only; wallet
pays the base, no fee). Wallets migrate to USD with a currency-match guard.
Delivered in three steps (Step 1 shipped separately as `77dbd1f`).

## 1. What this PR does

- **Step 1 (77dbd1f):** single-sourced all session-price displays from
  `session-config`; added `GET /booking/session-types` for the staff titles.
- **Step 2 — USD:** `session-config.priceNZD → price` + explicit `currency`
  (`USD`). Stripe booking checkout currency is driven from config (no `'nzd'`
  literal). Every client-facing session surface shows the config currency — no
  `NZD`, no bare `$`.
- **Step 3 — card fee:** a **percentage** fee (default **10%**, env
  `SESSION_CARD_FEE_PERCENT`), applied ONLY to card. Card total =
  `round(baseCents * 10%) + baseCents`, integer cents. Disclosed as its own line
  in the chooser, the paid flow, and on the Stripe page ("… includes $X card
  processing fee"); wallet shows the base with "no fee".
- **Wallet:** `Wallet.currency` default → `USD`; the one empty NZD wallet
  migrated; `payWithWallet` gains a **currency-match guard** (wallet.currency ≠
  session currency → reject; card still works).
- Client-facing GAP/LIA price strings in the scoring content (routing, engine,
  PDF) now read config.

## 2. Files changed

**Backend**
- `booking/session-config.ts` — `price` + `currency` (USD 20 / 58 / 0).
- `booking/session-pricing.ts` — **new** single pricing helper: `cardFeePercent()`,
  `computeCardFeeCents()`, `getSessionPricing()`, `cardChargeForHeld()`.
- `booking/booking-eligibility.service.ts` — payload carries `currency`,
  `priceCents`, `cardFeeCents`, `cardTotalCents` (from `getSessionPricing`).
- `booking/booking.service.ts` — `createHold` stamps `price` + `currency` + fee;
  `getHoldForCheckout` returns `currency`; `payHeldBookingWithWallet` debits the
  hold's base with the **currency guard**; `createFreeBooking` stamps currency.
- `booking/booking.controller.ts` — checkout computes fee **server-side** off the
  hold; `session-types` returns config `price`/`currency`.
- `payments/stripe.service.ts` — `createBookingCheckoutSession` currency from
  config; fee as a separate disclosed Stripe line item. (Other Stripe methods
  and the account-opening path untouched.)
- `scorecard/scoring/routing.ts`, `scoring/engine.ts`, `pdf/client-report.ts` —
  GAP/LIA price strings read config.
- `prisma/schema.prisma` + `migrations/20260716000000_wallet_currency_usd/`.

**Frontend**
- `lib/booking/eligibility.ts` — new pricing fields + `money()` formatter.
- `app/portal/booking/page.tsx` — chooser + paid-flow fee disclosure; USD.
- `components/scorecard/ScorecardResultClient.tsx` — CTA prices from payload.

**Test (local-only, gitignored):** `scripts/test-session-pricing-usd.ts`.

## 3. Schema added

One migration — `wallet` currency:
```sql
ALTER TABLE "wallet" ALTER COLUMN "currency" SET DEFAULT 'USD';
UPDATE "wallet" SET "currency" = 'USD' WHERE "balanceCents" = 0 AND "currency" = 'NZD';
```
Idempotent + additive. Applied to prod via psql (autocommit) after a snapshot and
a pre-write check (0 funded wallets, 0 `wallet_transaction` rows); `prisma migrate
deploy` on the next start re-applies it as a no-op and records it.

## 4. Endpoint contract

- `GET /booking/eligibility` → each type now returns `{ currency, priceCents,
  cardFeeCents, cardTotalCents }` (cents; no floats).
- `POST /booking/hold` → response gains `currency`, `cardFeeCents`,
  `cardTotalCents`.
- `POST /booking/checkout` → body is `{ consultationId, accepted }` **only** (no
  amount) — the card total is computed server-side from the hold.
- `POST /booking/pay-with-wallet` → debits the base; rejects on currency mismatch.
- `GET /booking/session-types` → `{ type, price, currency, label }` (staff).

## 5. Configuration

- `SESSION_CARD_FEE_PERCENT` (default **10**) — session card fee. **Distinct** from
  the account-opening `CARD_SURCHARGE_CENTS` (flat $20, untouched). Prod runs on
  the default (env unset).
- Prices/currency live only in `session-config.ts`.

## 6. How to test

`scripts/test-session-pricing-usd.ts` — **15/15**: GAP=USD 2000/200/2200,
LIA=5800/580/6380 (no float drift); FREE=0/0/0; percent-not-flat (10% of 2000 =
200 ≠ 2000); Stripe-min clearance; env default 10; eligibility payload USD+fee;
`assertEligible` still blocks at `createHold` (Phase C); wallet guard rejects
NZD-wallet/USD-session and allows USD/USD → CONFIRMED; checkout DTO has no amount
field. Phase-C `test-booking-eligibility.ts` and `test-ops-compliance.ts` still
green. `tsc` clean (backend src + frontend 0 errors).

## 7. Known limitations / edge cases handled

- **(a) FREE_15**: `computeCardFeeCents(0)=0`, cardTotal 0 — no fee, no Stripe,
  no currency line.
- **(b) rounding**: fee = `round(priceCents * pct/100)` on integer cents; whole-
  dollar prices divide evenly (5800×10% = 580 exact). For any non-even price the
  fee cents round half-up.
- **(c) Stripe minimum**: $22 / $63.80 clear the USD $0.50 minimum; free = no charge.
- **(d) in-flight holds**: the hold stamps `currency` + base; checkout/wallet read
  the hold (never re-read config), so a hold settles at its quoted price/currency.
  Prod in-flight holds at migration time: **0**.
- **(e) open Stripe sessions**: the webhook trusts Stripe's captured
  `amount_received` and never recomputes. Prod open sessions: **0**.
- **(f) refunds**: `computeRefund` works off `Payment.amount` (captured cents) and
  the consultation's stored `currency` — never config. Prod paid bookings: **0**.
- **(g) engagement invoice**: `ENGAGEMENT_FEE_*` + flat `CARD_SURCHARGE_CENTS` and
  `portal.service` / `contracts.service` — **not touched** (verified).
- **(h) `$20` feeLabel on `/portal/case/pay`**: not touched — that flow is
  unchanged.
- **(i) wallet credit**: refund credit is cents-based against the (now USD)
  wallet; the guard prevents mixed-currency debits. Prod wallet balances: **0**.
- **(j) env unset in prod**: `SESSION_CARD_FEE_PERCENT` default 10 verified
  standalone.

## 8. How to extend

- Change a price/currency: edit `session-config.ts` only.
- Change the fee: set `SESSION_CARD_FEE_PERCENT`, or edit the default in
  `session-pricing.ts`. All display + charge math flows from `getSessionPricing`.

## 9. Security layers applied

- **Fee computed server-side** in `session-pricing`, off the hold/checkout base —
  the checkout DTO carries **no** client amount (proven).
- **Tamper-proof total**: nothing client-writable feeds the charge; a client
  cannot send a total.
- **`assertEligible` preserved** (Phase C) — runs before any hold/charge.
- **Currency guard** blocks mixed-unit wallet debits.
- **Snapshot before the wallet migration**; pre-write funded/txn check.
- No price/currency in a client-writable field.

## 10. Rollback procedure

- **Code:** revert this commit and `77dbd1f`.
- **Schema:** the wallet default can be reverted to NZD
  (`ALTER TABLE "wallet" ALTER COLUMN "currency" SET DEFAULT 'NZD';`) — no funded
  wallets exist, so no data is stranded. Leaving USD is harmless.
- **Order:** deploy backend before frontend (the report/chooser read the new
  payload shape); revert frontend first on rollback.
