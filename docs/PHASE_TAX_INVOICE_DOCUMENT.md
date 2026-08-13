# Phase — Tax invoice document

**Date:** 13 August 2026
**Status:** approved and shipped
**Depends on:** `PHASE_GST_PRICING_CORRECTION.md` (this was blocked on that arithmetic)

**Bank account — resolved.** The account supplied at the start of this phase
(`38-9022-0355698-00` / `SORENA STUDY LIMITED`) was wrong. The correct account is the one
already live: **`38-9022-0355698-01` / `SORENASTUDY LIMITED`**, which is the code default
and reaches the document because production has **0 configured `platform_setting` bank
rows**. No config change was made and none is needed. The discrepancy was flagged rather
than assumed, which is why nothing was printed on a client-facing tax document from a wrong
number. The renderer reads `settings.getBankDetails()` live on every generation, so if the
account ever does change it is an admin edit, not a deploy — and the document cannot
disagree with the pay screen.

## 1. What this phase does

Until now a Sorena invoice existed only as a row, rendered as text on two web pages. A
client had nothing to keep, nothing to forward to whoever was actually paying, nothing to
give a bank, and no sight of the GST the platform records against them.

This adds the document: an A4 **TAX INVOICE**, generated on demand, downloadable by the
client who owns it and by the money tier of staff.

**One document per invoice, not an invoice-and-receipt pair.** Its status is printed on its
face and is true at the moment of download, because every field is read from the row each
time. Nothing is stored.

## 2. Files created or changed

**Added — backend**
- `src/invoices/invoice-company.ts` — the legal identity a NZ tax invoice must carry
- `src/invoices/invoice-pdf.ts` — the A4 renderer
- `src/invoices/invoices.service.ts` — access rules, figures, audit
- `src/invoices/invoices.controller.ts` — the two routes
- `src/invoices/invoices.module.ts`
- `src/invoices/invoices.service.spec.ts` — 18 tests

**Added — frontend**
- `src/components/portal/InvoicePdfButton.tsx`
- `src/lib/invoice-status.ts` — **not invoice scope**; a production bug fix, see §6b

**Changed**
- `backend/src/app.module.ts` — registers `InvoicesModule`
- `frontend/src/components/portal/PaymentsView.tsx` — download button on outstanding and
  settled rows; takes the full invoice list
- `frontend/src/app/portal/payments/page.tsx`, `src/app/student/payments/page.tsx`
- `frontend/src/app/portal/case/pay/page.tsx` — download on both the unpaid and paid states
- `frontend/src/i18n/messages/{en,fa}.json` — one label per namespace

## 3. Database tables/columns added

**None.** No migration. The document is generated from the existing `Invoice` row, the
`Contact` it belongs to, and the bank details already in platform settings.

## 4. Environment variables added

**None.**

## 5. Third-party services connected

**None.** `pdfkit`, already a dependency for the scorecard PDF.

## 6. How to test it works

```
GET /portal/me/invoices/:invoiceId/pdf     LEAD, STUDENT — own invoice only
GET /staff/invoices/:invoiceId/pdf         OWNER, SUPER_ADMIN, FINANCE — any invoice
```

Verified over real HTTP against a running backend, and in a real browser, not computed:

1. **`invoices.service.spec.ts` — 18/18.** Proven meaningful: with the ownership check and
   the staff role gate both removed, **6 tests fail**; restored, 18 pass.
2. **Access, over HTTP — 25/25.** Owner 200 with `%PDF-` bytes, correct
   `Content-Type`/`Cache-Control: no-store`/filename; **foreign invoice 404, unknown id 404,
   indistinguishable**; no token 401; garbage token 401; FINANCE 200 on the staff route;
   SALES 403; LEAD 403; FINANCE 403 on the *client* route. Denied requests write no audit row.
3. **Nothing is stored — verified, not asserted.** Flipping the row `SENT → OVERDUE` and
   re-downloading the same URL produced different bytes. No `Document` row is created.
4. **The document agrees with the pay screen — 12/12, against a real dev invoice.** Base,
   GST, bank total, card fee and card total each read out of the rendered PDF and compared
   to `pay-options`: all five match, plus the live bank account number. Proven meaningful:
   mutating the renderer to drop the GST from the total makes exactly that check fail.
5. **Browser click-through — 9/9.** Signed in as a real client; on `/portal/payments` and
   `/portal/case/pay` the button is present, clicking it downloads a real PDF named after
   the invoice. No console errors.
6. **Suites: 100 passed, 1208 tests passed** (`--runInBand`; see §7).

Both status variants were rendered and read by eye: UNPAID shows an amber chip, "Total due",
the card-fee note and the bank instructions; PAID shows a green chip, the paid date,
"Total", and **no** payment instructions.

## 6b. Also shipped here — a live production bug, fixed

This is **not** invoice scope. It shipped with this phase because the download button could
not render without it, and because it is broken in production today.

**The symptom.** On `/portal/payments` and `/student/payments`, the **"Outstanding" section
never rendered.** A client with an unpaid invoice saw the empty state — *"No payments yet /
Your payments and receipts will appear here once you've made one."* Indistinguishable from
owing nothing.

**The cause.** `PAYABLE_STATUSES` was defined in `PaymentsView.tsx` — a `'use client'`
module — and imported by two **Server** Components. In a production build Next.js turns a
client module's exports into client *references*, so on the server it was not an array.
`PAYABLE_STATUSES.includes(inv.status)` threw, the surrounding `try/catch` swallowed it
(that catch exists to keep a failed fetch non-fatal), and `outstanding` stayed `[]` forever.

Nothing logged. Nothing failed. Types were satisfied — `tsc` sees the real array, only the
runtime sees the reference. It does not reproduce in `next dev`.

**The fix.** Moved the constant to `frontend/src/lib/invoice-status.ts`, a plain module both
sides can read. `PaymentsView` re-exports it so no other reader breaks.

**Before / after** — same client, same invoice, same page, production build:

| | |
|---|---|
| **Before** | `outstanding: []` in the RSC payload while `invoices` held the `SENT` row. Page showed *"No payments yet"*. |
| **After** | *OUTSTANDING → Account opening fee · USD 200.00 · due 24 Aug 2026*, with **Tax invoice** and **Pay now**. |

Caught only by the browser click-through against populated data. A build, `tsc`, and the
unit suite were all green while this was broken — **an empty state and a broken feature look
identical.**

**Worth a follow-up:** any other value shared across the server/client boundary from a
`'use client'` file has the same defect and would fail just as silently.

## 7. Known limitations

**⚠ `/portal/payments` states the pre-GST figure — the last instance of today's bug class.**
The outstanding card reads **"USD 200.00"** while the tax invoice beside it, and the pay
screen behind it, both say **USD 230.00**. `GET /portal/me/invoices` returns only `amount`
(the base), so the list has nothing else to show. This is the same shape as the pay-screen
under-charge fixed this morning, in a third place. **Not fixed here** — it changes a shared
endpoint's payload and belongs with Group 2/3 of the hardcoded-fee work. It is the first
thing to fix next.

**The test suite is flaky under parallel execution, and was before this phase.** Runs show
5–8 integration suites failing on shared-database contention; the set varies run to run;
identical with and without these changes; **green at 100/100 with `--runInBand`.** Not
caused here, but it means "the suite is green" is currently only true serially.

**English only, by decision.** The rest of the platform mirrors Persian; a tax document does
not. The two new UI labels are translated; the document is not.

**Sponsor access is out of scope,** by decision. Authenticated only — no signed link, no
stored file, so there is nothing to forward but the PDF itself.

## 8. How a future developer would extend this

Add a line item by extending the table in `invoice-pdf.ts`; the totals block reads
`InvoicePdfData`, so a second line means summing before it, not changing the layout.

**Do not add a stored copy.** The whole design rests on the document being rendered from the
row: a stored PDF has to be invalidated on payment, on Finance verification and on any
correction, and the failure mode is a stale "you owe this" sitting in an inbox after the
client has paid.

**Do not hardcode a figure.** `calculateFeeBreakdown` produces every number on the document,
which is what makes it impossible for the invoice and the pay screen to disagree — and
what test 4 above actually checks.

Company identity lives in code (`invoice-company.ts`) because it is a fact, reviewable in a
diff. Bank details live in platform settings because an admin changes them. Keep that split.

## 9. Security layers applied

1. **Authentication** — `JwtAuthGuard` on both routes; no token and a malformed token both
   401, verified over HTTP.
2. **Authorisation** — `RolesGuard` with `@Roles`; the client route is LEAD/STUDENT, the
   staff route is OWNER/SUPER_ADMIN/FINANCE, and the service re-checks with `hasRole` rather
   than trusting the decorator alone. FINANCE gets 403 on the client route: the gates are
   separate rules, not one rule with a branch.
3. **Ownership** — resolved from the JWT (`contact.userId`), never from anything the caller
   supplies. Resolved through the **required** `contactId`, not the optional `caseId`, so it
   covers the 333 of 985 dev invoices that have no case and which the pay screen cannot serve.
4. **Enumeration** — a foreign invoice and a non-existent one both answer 404, verified to be
   indistinguishable. A 403 would confirm somebody else's invoice exists.
5. **No caching** — `Cache-Control: no-store, max-age=0`, because a cached "UNPAID" surviving
   the payment is precisely what the one-document design exists to prevent.
6. **Audit** — one `INVOICE_PDF_GENERATED` row per successful generation, recording the
   status that was printed and whether it went out via the client or staff route. Wrapped in
   try/catch: a broken audit table must not stand between a client and their own invoice —
   it is logged instead. Denied requests write nothing.

Nothing is persisted, so there is no new object to leak, no signed URL to replay, and no
stored file to go stale.

## 10. Rollback instructions

Revert the commit. Nothing persisted changed shape and there is no migration to unwind; the
buttons disappear and the routes 404.

⚠ **The `PAYABLE_STATUSES` fix in §7 should NOT be reverted with it.** It fixes a
pre-existing production bug that has nothing to do with the invoice document — reverting it
puts the "Outstanding" section back to silently never rendering. If this phase is rolled
back, keep `lib/invoice-status.ts` and its two imports.
