# Phase — Client Payment History (/student/payments)

## 1. What this does

Replaces the old "Coming soon" stub at `/student/payments` with a real, read-only
payment history & receipts view. A logged-in client sees **their own** payments —
newest first — each showing the date (DD/MM/YYYY), a "what it was for" label (the linked
invoice number when the payment settled an invoice, otherwise a friendly type label),
the amount (formatted from integer cents, e.g. `NZD 150.00`), and a human status ("Paid"
rather than the raw Stripe "succeeded"). A calm "No payments yet" empty state shows when
the client has no payments. The list is strictly scoped to the caller's own payments.

## 2. Files created / changed

- **backend/src/portal/portal.controller.ts** — adds `GET /portal/me/payments`
  (LEAD/STUDENT-gated) returning the caller's own payment history.
- **backend/src/portal/portal.service.ts** — adds `getMyPayments(userId)` (ownership-
  scoped read-only query + client-safe shape) and the `readInvoiceId` / `paymentLabel`
  helpers that derive the human label.
- **frontend/src/app/student/payments/page.tsx** — replaces the "Coming soon" stub with
  the real history view (list, date/label/amount/status, empty + error states).

## 3. Database tables / columns added

**NONE.** This is a read-only feature over the **existing** `Payment` rows (joined to
`Invoice` only to resolve an invoice number for the label). No new table, no new column,
no schema change, no migration.

## 4. Env vars added

**NONE.**

## 5. Third-party services

**None new.** It reads `Payment` rows that are produced by the existing Stripe webhook
path (`payment_intent.succeeded`). This feature does not call Stripe or any external
service — it only reads what's already in the database.

## 6. How to test

**UI:** log in as `lead2@booking.test`, go to `/student/payments`. Expect **two rows**
(newest first): `Invoice TEST-INV-001 — NZD 150.00 — Paid` (06/07/2026) and
`Payment — NZD 30.00 — Paid` (02/07/2026) — not the old "Coming soon" card.

**Endpoint:** `GET /portal/me/payments` with the client's JWT returns HTTP 200 and an
array of the caller's own payments in the shape
`[{ id, createdAt, amountCents, currency, status, label, invoiceNumber? }]`. Verified in
testing that it returns only the caller's payments (see §9).

## 7. Known limitations

- **No downloadable PDF receipt** — a payment-received **email** receipt already exists
  separately (sent by the webhook via `MailService.sendConsultationConfirmation`); this
  view does not render or download a PDF.
- **No pagination** — the full list is returned; fine at current volume.
- **Currency is shown as stored** on the payment row (e.g. `NZD`) — no FX conversion.
- **Label fallback** — when a payment has no linked invoice (`metadata.invoiceId`), the
  label falls back to a `paymentType`-derived string (`Consultation` /
  `Account opening payment` / `Subscription`) or a neutral `Payment`.

## 8. How to extend

- **Pagination** — add `skip`/`take` (or cursor) params to `getMyPayments` and a
  "Load more" control on the page; the query already orders by `createdAt desc`.
- **PDF receipt download** — add a per-payment endpoint that renders a receipt PDF
  (reuse the scorecard PDF pattern), and a download button on each row.
- **Filters** — filter by status/date range or paymentType by extending the `where`
  clause (keep the `lead.contact.userId` ownership filter as the base — never remove it).

## 9. Security layers applied

- **Access control (#2)** — `GET /portal/me/payments` is gated to `LEAD` / `STUDENT`
  (the `PortalController` class-level `RolesGuard` + `@Roles('LEAD','STUDENT')`).
  Ownership is resolved **server-side** from the JWT via the
  `lead.contact.userId` chain (`where: { lead: { contact: { userId } } }`) — the same
  chain `getMyCase` uses. **No id or amount is ever taken from the request.** Verified in
  testing: a payment created on a foreign case (not owned by the caller) does **not**
  appear in the caller's list.
- **Authentication (#1)** — `JwtAuthGuard` (class-level on `PortalController`) requires a
  valid signed-in user; `userId` comes only from the verified token.

## 10. Rollback

- Revert the single commit — no DB migration to undo (nothing schema-level changed).
- Restoring the old "Coming soon" stub page (`frontend/src/app/student/payments/page.tsx`)
  removes the view with **no backend impact**; the `GET /portal/me/payments` route +
  `getMyPayments` simply go unused (they can be left in place or reverted with the same
  commit).
