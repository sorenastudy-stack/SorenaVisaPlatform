# Phase — Client Payment Options Screen (3 methods)

## 1. What this does

The client invoice pay screen now offers **three payment methods** for an unpaid
engagement invoice, reached from the INVOICE "what to do next" step on `/portal/case`:

- **Stripe card** — grossed up to **USD 220.00** via a config card surcharge; the stored
  Invoice stays **$200** (the surcharge is added to the Stripe charge only).
- **NZ bank transfer** — Kiwibank details, **no fee**, presented as the **recommended**
  option (gold-accented), with per-field copy buttons.
- **Partner exchange (Rebit)** — an external link for clients who can't use card or bank,
  showing the **$200** amount.

This piece is presentational **plus** a server-side card gross-up. It does **not** upload
receipts, confirm payments, gate anything, or change the invoice status.

## 2. Files changed

- **backend/src/portal/portal.service.ts** — `createInvoicePayLink` grosses the Stripe
  charge up by `CARD_SURCHARGE_CENTS` (Invoice untouched); new read-only
  `getInvoicePayOptions` (base/card cents, currency, client name) + a `cardSurchargeCents`
  helper.
- **backend/src/portal/portal.controller.ts** — new `GET
  /portal/me/invoices/:invoiceId/pay-options` (LEAD/STUDENT).
- **backend/.env.example** — documents `CARD_SURCHARGE_CENTS`.
- **frontend/src/app/portal/case/pay/page.tsx** — the three-option pay screen (server
  component).
- **frontend/src/components/portal/CopyButton.tsx** — small copy-to-clipboard control for
  the bank-detail values.
- **frontend/src/app/portal/case/page.tsx** — the INVOICE next-step now links to the pay
  screen instead of the inline button.
- **frontend/src/components/portal/PayInvoiceButton.tsx** — optional `label` prop (reused
  as the card button label).

## 3. Database changes

**NONE.** No new table, no new column, no migration. The card surcharge lives in config;
the pay-options endpoint is read-only over the existing `Invoice` (and the case's contact
name). The stored Invoice amount is never mutated.

## 4. Env vars added

- **`CARD_SURCHARGE_CENTS`** — the flat card-processing surcharge added to the Stripe
  charge, in integer cents. **Default 2000** ($20). Config, not a secret; has a safe
  in-code default.

## 5. Third-party services

- **Stripe** — the card path (`pay-link` → Stripe hosted payment page for the grossed-up
  total).
- **Rebit (partner exchange)** — an external link only:
  `https://my.rebitmoney.com/auth/register?code=SORENA` (opens in a new tab,
  `rel="noopener noreferrer"`).
- **Kiwibank** — bank-transfer account details are **displayed** for the client to pay
  into (no integration; display only).

## 6. How to test

Log in as `lead2@booking.test`, go to `/portal/case` → click **Pay now** on the INVOICE
step → land on `/portal/case/pay`, which shows the three options:
- **Card** shows **USD 220.00**; the `pay-link` POST charges **22000 cents server-derived**
  (invoice 20000 + surcharge 2000), and the client cannot override the amount.
- **Bank transfer** shows **USD 200.00**, the Kiwibank block (Bank / Address / Account
  Name / Account Number / SWIFT / Particular / Code / Reference) with copy buttons on the
  real values.
- **Rebit** shows **USD 200.00** and the partner-exchange link.

Verified in the prior phase: pay-options returns `baseCents 20000 / cardCents 22000 /
surchargeCents 2000 / USD / clientName`; the card charge was 22000 (audit `chargeCents`);
a malicious body amount was ignored; the Invoice stayed $200; and a foreign invoice
returned 404 on both endpoints.

## 7. Known limitations

- **Bank & Rebit have no auto-confirmation yet** — a client paying by bank transfer or
  partner exchange is not automatically marked paid; manual verification (receipt upload +
  accountant confirmation) is the **next** piece. Only the Stripe card path reconciles
  automatically (existing webhook).
- **The "Code" field shows guidance text** (`Your Client ID (leave blank if new)`) because
  there is no Client ID field in the data yet — it is intentionally non-copyable.
- **The card surcharge is a flat config amount** (`$20`), not live-calculated from Stripe's
  exact per-transaction fee.

## 8. How to extend

- **Receipt upload + accountant confirmation** (next piece) — add a client receipt-upload
  surface for the bank / Rebit paths and a staff confirmation action that flips the invoice
  to PAID; hook it alongside the existing card reconciliation.
- **Real Client ID** — introduce a client/case reference field and return it from
  `getInvoicePayOptions`, then render it (copyable) in the Code row instead of the guidance
  fallback.
- **Per-region method filtering** — surface/hide methods by the client's country (e.g. show
  Rebit first for Iran) using data already on the case.

## 9. Security layers applied

- **Access control (#2)** — both `GET …/pay-options` and `POST …/pay-link` are
  `LEAD`/`STUDENT`-gated; ownership is resolved **server-side** from the JWT via the
  `lead.contact.userId` chain, and a foreign invoice returns the **same 404** as
  not-found (no existence leak). The **$220 charge is derived server-side** from the
  Invoice amount + the config surcharge — the client sends no amount and **cannot override
  it** (verified: a malicious body was ignored).
- **Authentication (#1)** — `JwtAuthGuard` (class-level on `PortalController`); `userId`
  comes only from the verified token.
- **No money-write / no mutation** — the Invoice row is never changed by this phase; the
  gross-up affects only the Stripe charge amount.

## 10. Rollback

- Revert the single commit — **no DB migration to undo** (nothing schema-level changed).
- The pay screen reverts to the prior inline **Pay-now** button on the INVOICE step (the
  new `/portal/case/pay` route + `pay-options` endpoint + `CopyButton` simply go unused, or
  are removed by the same commit). The `CARD_SURCHARGE_CENTS` config var is harmless if
  left.
