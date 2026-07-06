# Phase — Engagement Invoice on Contract Sign (Gap #4)

## 1. What this does

When a client signs their contract, the DocuSign webhook auto-creates a fixed **USD 200**
engagement invoice (`ENG-<caseId>`, status `SENT`) for that case. The existing Pay-now UI
(Gap #2) surfaces that SENT invoice automatically on `/portal/case` — so the client goes
from **sign → pay with no human step**. Zero staff action: no one has to raise the invoice
or send a link.

## 2. Files changed

- **backend/src/contracts/contracts.service.ts** — adds `maybeCreateEngagementInvoice`,
  called from `handleWebhook` right after the LEAD→STUDENT promotion; it creates the
  engagement invoice when the CLIENT party has signed (best-effort, idempotent).
- **backend/.env.example** — documents the two config keys `ENGAGEMENT_FEE_CENTS` and
  `ENGAGEMENT_FEE_CURRENCY` (with their default values).

## 3. Database tables / columns added

**NONE.** This reuses the existing `Invoice` model as-is (no new column, no new table, no
migration). The fee lives in **config/env**, not in a database column.

## 4. Env vars added

- **`ENGAGEMENT_FEE_CENTS`** — the fee in integer cents. **Default 20000** (USD 200.00).
- **`ENGAGEMENT_FEE_CURRENCY`** — the currency. **Default USD**.

Both have safe in-code defaults (read via `process.env.… ?? default`), so the feature
works with neither set. They are **config, not secrets** — fine to keep in `.env.example`.

## 5. Third-party services

- **DocuSign** — the "client signed" webhook (`contracts` webhook → `handleWebhook`) is
  what triggers the invoice creation.
- **Stripe** — the client pays via the existing Gap #2 pay-link path (`POST
  /portal/me/invoices/:invoiceId/pay-link` → Stripe hosted page).
- **Note:** the engagement invoice currency is **USD** — the **Stripe account must accept
  USD** for the Pay-now checkout to succeed.

## 6. How to test

On a client-signed DocuSign webhook for a case, an `ENG-<caseId>` invoice is created once
(status `SENT`, USD 200.00), and the client sees **Pay now** for it at `/portal/case`
(Gap #2 surfaces `SENT`/`OVERDUE` invoices). **Idempotency:** a re-delivered signed
webhook (or a re-sign) does **not** create a second invoice and does not throw — the
deterministic `invoiceNumber = ENG-<caseId>` + the `invoiceNumber @unique` constraint make
the create a no-op the second time.

Verified in this phase (directly against the DB, calling the real service method): first
event created `ENG-<caseId>` SENT / USD 200.00 with an `INVOICE_CREATED_ON_SIGN` audit row;
a second identical event left exactly **one** invoice and **one** audit row with no
exception; and the case's SENT set then contained the ENG invoice (so Pay-now renders).

## 7. Known limitations

- **Fixed single fee** for all engagements (USD 200) — no per-case / per-package pricing.
- **Invoice label** shows `ENG-<caseId>` (the raw invoice number), not a friendly name.
- **Full end-to-end webhook trigger is unverified locally** because the DocuSign JWT
  credentials aren't set in the local environment (deploy-day config) — the invoice
  **creation + idempotency logic** was verified directly against the DB by invoking the
  real service method; the webhook wiring that calls it is typechecked.
- **Currency is USD regardless of the client's country** (no localisation of the fee).

## 8. How to extend

- **Per-case / per-package fee** — replace the `ENGAGEMENT_FEE_CENTS` env read inside
  `maybeCreateEngagementInvoice` with a lookup (case package, contract template, or a
  pricing table); keep the deterministic `ENG-<caseId>` invoice number for idempotency.
- **Friendlier label** — the client-facing label is derived elsewhere (Gap #2's
  `paymentLabel` / the invoice `description`); set a nicer `description` at creation and/or
  map `ENG-*` to a display name in the portal.
- **Config → table** — move the fee (and currency) from env into a `PlatformSetting`-style
  config table so Owners can change it without a redeploy; read it in the same method.

## 9. Security layers applied

- **DB backup (#10)** — a Postgres backup was taken before the money-write:
  `backend/backups/pre-gap4-engagement-invoice-*.sql`.
- **Audit log (#6)** — every auto-creation writes an `INVOICE_CREATED_ON_SIGN` row
  (`actorRoleSnapshot: 'SYSTEM'`, `userId: null`, `newValue: { caseId, amountCents,
  currency }`).
- **Access control (#2)** — payment happens via the **existing client-scoped Gap #2
  path** (ownership resolved from the JWT); this phase adds **no new client surface** and
  no client-triggerable creation (creation is webhook-only, server-side).
- **Idempotency guard** — deterministic `invoiceNumber = ENG-<caseId>` + `invoiceNumber
  @unique`, with a fast-path existence check and a `P2002` catch, so a webhook
  re-delivery cannot create a **second charge** (one engagement invoice per case, ever).
- **Best-effort isolation** — the whole method is wrapped in try/catch and never throws,
  so a failure can't break the webhook response or block the LEAD→STUDENT promotion.

## 10. Rollback

- Revert the single commit — **no DB migration to undo** (nothing schema-level changed).
- To stop auto-creation with no other impact, remove the `maybeCreateEngagementInvoice`
  call in `handleWebhook` (the method can stay unused or be reverted with the same commit).
- The `ENGAGEMENT_FEE_CENTS` / `ENGAGEMENT_FEE_CURRENCY` config vars are harmless if left
  in place (nothing reads them once the call is removed).
