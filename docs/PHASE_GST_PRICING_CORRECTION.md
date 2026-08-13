# Phase — GST pricing correction

**Date:** 13 August 2026
**Commits:** `2b9d3b5` (charging logic) · `2f0c6f8` (chatbot + staff labels) ·
`SHA3` (client-facing hard-stop prices)

## 1. What this phase does

Sorena was charging clients less than it believed it was charging them, and telling them
prices that had been wrong for months.

Three separate problems, found in one session, all the same shape: **a number written down
by hand instead of read from the place that owns it.**

1. **The account-opening fee was charged without its GST.** The invoice row stored a $30
   GST figure; the pay screen never read it. A client paid **USD 200** by bank transfer
   while the platform believed **USD 230** was owed — and the accounting dashboard's GST
   card summed a tax that had never been collected.
2. **The card fee was a flat $20 env value**, not the 2.9% + $0.30 `fee-config` declares —
   about three times Stripe's actual cut.
3. **Four strings quoted prices that no longer existed**, in three different places, for a
   service priced in USD: "200 NZD" (chatbot), "$150" (staff label, EN + FA), "NZD 150"
   (hard-stop resolution), "NZD 50" (hard-stop resolution).

**No live client was affected.** Production holds three invoices — two CANCELLED, one PAID
at zero — all predating the GST columns.

## 2. Files created or changed

**Added**
- `backend/src/scorecard/scoring/fee-label.ts` — one function that writes a price a client
  will read, derived from `calculateFeeBreakdown`

**Changed**
- `backend/src/portal/portal.service.ts` — both payment paths use `calculateFeeBreakdown`;
  `cardSurchargeCents()` deleted
- `backend/src/booking/session-pricing.ts` — comment corrected (it described the deleted
  constant)
- `frontend/src/app/portal/case/pay/page.tsx` — shows the GST-inclusive total
- `backend/src/ai/compliance-guard.service.ts` — CTA reads fee + bank details from config;
  `scan()` became async
- `backend/src/ai/{ai.controller,agents/lead-qualification.agent,ai.module,compliance-guard.test}.ts`
- `backend/src/scorecard/scoring/{hard-stops,engine}.ts` — three client-facing prices
- `frontend/src/i18n/messages/{en,fa}.json` — four labels

## 3. Database tables/columns added

**None.** Every field already existed; only what was read from them changed.

## 4. Environment variables added

**None — one removed.** `CARD_SURCHARGE_CENTS` is retired. It is now unused; delete it from
Railway at leisure.

## 5. Third-party services connected

**None.** Stripe is charged a different amount, through the same integration.

## 6. How to test it works

```
bank transfer   USD 200.00 -> USD 230.00   (+30.00, the GST)
card            USD 220.00 -> USD 236.97   (+16.97; the fee itself FALLS
                                            20.00 -> 6.97, Stripe's real cut)
```

1. `GET /portal/me/invoices/:id/pay-options` returns `baseCents 20000`, `gstCents 3000`,
   `bankCents 23000`, `surchargeCents 697`, `cardCents 23697`. **Verified over HTTP against
   a running backend, 7/7** — not computed.
2. `feeLabel('LIA_CONSULTATION')` → `USD 66.70 incl. GST`; `ACCOUNT_OPENING` → `USD 230.00`.
3. An assessment triggering HS2 + HS4 produces resolutions quoting **USD 57.50** and
   **USD 66.70**, and those strings render into the client PDF. Verified by running the real
   engine and the real renderer, 6/6.
4. `npx ts-node --transpile-only src/ai/compliance-guard.test.ts` — the stress test.
5. 1,190 tests / 99 suites.

⚠ **One verification lesson worth keeping.** The first hard-stop check passed 4/4 while
asserting nothing: the fixture used invented answer keys, no rule fired, and every "does not
contain NZD 150" assertion was true of an empty list. It now fails loudly if no rule fires.
A test that cannot fail is worse than no test, because it reports success.

## 7. Known limitations

**⚠ The Persian GST wording is unverified.** `malaysiaBody` and two labels in `fa.json`
gained a Latin `GST` token, matching how those strings already carry Latin `USD`. It is
correct in substance and **has not been reviewed by a Persian speaker** — it may not be how
a native speaker would phrase a tax inclusion. Treat as pending translation review, not
final.

**⚠ The hardcoded-fee-string problem is structural, and only partly fixed.** Three
independently wrong prices were found in one session, by two different sweeps, after phase
40 had already fixed a fourth. A systematic sweep of string literals containing money
turned up more. Split deliberately:

- **Group 1 — fixed here.** The three client-facing wrong prices
  (`hard-stops.ts:41,74`, `engine.ts:108`), because clients were reading them.
- **Group 2 — open.** `bands.ts` `revenue` labels: `'NZD 30 + NZD 50'` (should be USD 20 +
  USD 50) and three `'USD 200'` missing GST. Internal/planning labels; no client render
  found.
- **Group 3 — open, and the actual cure.** Derive *all* fee copy from
  `calculateFeeBreakdown`. `ConsultationLinkGenerator.tsx` holds four hand-computed totals
  (`USD 23.97`, `USD 59.47`, `USD 68.93`, `USD 236.97`) which are correct today and will rot
  the next time a price or the GST rate moves; `en.json` has `"Admission Consultation
  ($50)"` likewise. `fee-label.ts` is the pattern to extend.

  **This wants its own scoping pass, not a bolt-on.** It is the third instance of the same
  class in one session, which makes it a structural gap rather than a set of typos.

**The DocuSeal engagement-letter template is unchecked.** It lives in DocuSeal's editor,
outside the repo. If it states a fee, that statement is not covered here — the Owner is
confirming separately.

**The tax-invoice document is still not built.** It was blocked on this arithmetic and is
now blocked only on the GST number.

## 8. How a future developer would extend this

Use `feeLabel()` for any price a person reads. Do not write a figure in prose — three
strings did, and all three were wrong.

For a price a person *pays*, use `calculateFeeBreakdown(baseCents, method, currency)`. It
returns base, GST, subtotal, card fee and total; never re-derive any of them. The card fee
belongs to card payments only — a bank transfer must never carry it.

`baseCents` in the pay-options payload still means the **pre-GST** fee. That was kept
deliberately so no existing reader silently changed meaning; new code should read
`bankCents` or `cardCents`.

## 9. Security layers applied

No authorisation surface changed. Ownership on the pay paths is unchanged (resolved from
the JWT, foreign invoice → 404).

**The amount is still entirely server-derived.** A client cannot supply or influence a
figure; the invoice row is the only input, and the arithmetic on top of it comes from
`fee-config`. This got stronger, not weaker: the charge is now computed by a shared
function rather than assembled from a mutable env var.

**A hardcoded bank account was removed.** `injectLiaCta()` carried Sorena's account number
inline, beside the admin-editable copy in platform settings — an admin changing the account
would have left the chatbot quoting the old one indefinitely. It now reads the live values.

**Audit trail widened.** `INVOICE_PAY_LINK_CREATED` records `gstCents` alongside the base
and total, so what was charged is reconstructable from the log.

## 10. Rollback instructions

Revert the three commits. Nothing persisted changed shape, so there is nothing to unwind —
the invoices carry the same columns they always did.

⚠ **Reverting reinstates the under-charge.** If any client has paid USD 230 under the
corrected logic, reverting would put the platform back to charging USD 200 while the row
still says $30 GST is owed. Check `invoices` for rows paid after this shipped before
considering it.

Restoring `CARD_SURCHARGE_CENTS` would also be required if the commit that removed it is
reverted alone; it has no reader now.
