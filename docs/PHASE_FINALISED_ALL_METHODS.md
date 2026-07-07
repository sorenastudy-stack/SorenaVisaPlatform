# Phase: Finance "Finalised" — All Payment Methods

## 1. What it does

The Finance Portal's **Finalised** ledger (and the Dashboard "Confirmed" count/total cards) now show **every** confirmed engagement payment in one place, regardless of how it was paid:

- **Stripe card** — auto-reconciled to PAID by the payment webhook (no human step).
- **Bank transfer / Partner exchange (Rebit)** — the client uploaded a receipt and an accountant confirmed it.

Each row is labeled by method — **Card**, **Bank transfer**, or **Partner exchange** — and shows who/what confirmed it (the finance user's name for bank/exchange, or "Stripe (automatic)" for card). Rows are sorted newest-first.

The **Processing** queue is deliberately unchanged: it still shows **only** bank/Rebit payments awaiting a human decision (receipt uploaded, invoice still SENT). Stripe payments never appear there — they go straight to PAID via reconciliation, so there's nothing for an accountant to decide.

## 2. Files changed

- `backend/src/staff/payments/staff-payments.service.ts` — `confirmedRows()` (the shared source for Finalised + Dashboard) widened to query **all PAID engagement invoices** (`invoiceNumber` starts with `ENG-`), deriving the method from the invoice's `receiptMethod`: `null` ⇒ **Card** (Stripe, "Stripe (automatic)"); `'bank'`/`'exchange'` ⇒ that method, with the confirmer's name from the `PAYMENT_CONFIRMED_BY_FINANCE` audit. Confirmed date = `paidAt` (fallback: the finance-confirm audit timestamp). Dashboard week filter made null-safe.
- `frontend/src/components/staff/finance/FinanceFinalisedClient.tsx` — added the **Card** method label + `CreditCard` icon (alongside Bank transfer / Partner exchange), and updated the subheading to "Every confirmed engagement payment — card, bank transfer, and partner exchange."

## 3. Database changes

**NONE.** No schema change, no migration, no data write. This is a read-only reporting widening — it derives everything from existing invoice state (`status = 'PAID'`, `invoiceNumber LIKE 'ENG-%'`, `receiptMethod`, `paidAt`) and existing audit rows.

## 4. Environment variables

**None new.**

## 5. Third-party services

**None new.** It only READS invoice state that the already-built Stripe reconciliation webhook or the accountant-confirm flow set. No new external calls.

## 6. How to test

As `finance@sorena.test`:

1. **Confirm a Stripe/card payment** — pay an ENG invoice by card so the webhook reconciles it to PAID (no receipt uploaded → `receiptMethod` stays null). It appears in **Finalised** labeled **Card**, confirmed-by **"Stripe (automatic)"**.
2. **Confirm a bank/exchange payment** — client uploads a receipt, then confirm it in the Processing queue. It appears in **Finalised** labeled **Bank transfer** (or **Partner exchange**), confirmed-by the **finance user's name**.
3. **Both show together** in Finalised, newest-first, each with client, case, amount + currency, method badge, paid date, and confirmed-by.
4. **Processing stays bank/Rebit-only** — the Stripe/card payment (and any PAID invoice) never shows in the Processing queue; only receipt-uploaded, still-SENT invoices do.
5. **Dashboard consistency** — the "Confirmed (last 7 days / all time)" counts equal the number of Finalised rows (both now count all methods).

Verified in a scripted run: a Stripe card invoice, a bank invoice, and an exchange invoice all appeared in Finalised with the correct method labels and confirmers; none appeared in Processing; the Dashboard all-time count matched the Finalised row count.

## 7. Known limitations

- **Method is inferred from `receiptMethod`**, not from a stored payment-instrument field: `null` is treated as Card (Stripe). An engagement invoice marked PAID by some path that neither uploaded a receipt nor went through Stripe would be labeled "Card" by default. In practice the only two PAID paths are Stripe (no receipt) and accountant-confirm (receipt set), so the inference is reliable.
- **Scope is engagement invoices only** (`ENG-%`). Other invoice types are intentionally excluded from this finance ledger.
- Cross-currency totals are grouped per currency (no FX conversion).

## 8. How to extend

The single source of truth is `confirmedRows()` in `staff-payments.service.ts`; both Finalised (`listFinalised`) and the Dashboard (`financeDashboard`) consume it. To change what counts as "confirmed", or to add a new method label, edit that one method (and add the label/icon in `FinanceFinalisedClient.tsx`). To broaden beyond engagement invoices, relax the `invoiceNumber startsWith 'ENG-'` filter.

## 9. Security layers

- **#2 Access control:** Finalised and the Dashboard stay **FINANCE + OWNER** gated server-side via `@StaffRoles('OWNER','FINANCE')` on `StaffFinanceController` (`GET /staff/finance/finalised`, `/staff/finance/dashboard`). A non-finance staff role (e.g. OPERATIONS) and any client role receive **403** — verified in testing. No gate was loosened; this change only widens the result set for already-authorized callers.
- Read-only: no money-write, no mutation of invoices, the confirm flow, or the Stripe reconciliation.

## 10. Rollback

Revert the commit — no migration to undo (no schema/data change). `confirmedRows()` returns to sourcing only `PAYMENT_CONFIRMED_BY_FINANCE`-audited (accountant-confirmed) invoices, and the frontend drops the Card label. Nothing else is affected.
