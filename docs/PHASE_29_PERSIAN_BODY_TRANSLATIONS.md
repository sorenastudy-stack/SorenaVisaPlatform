# Phase 29 — Persian / RTL body translations (client portal)

The larger piece deferred out of Phase 28: translating the actual page **content**
(not just nav/chrome) for the four client-portal areas — dashboard, messages,
case/pay, and booking. Shipped **per-area**, one commit + a Persian 390px screenshot
each, so it could be reviewed incrementally.

**Date:** 2026-07-29
**Commits:**
- `760caa4` — Phase 29.0 foundation + `/student` dashboard
- `2dc9789` — messages (`/student/case/messages`)
- `c25cbc6` — case/pay (`/portal/case/pay`) — legal-approved copy
- `daaae43` — booking (`/portal/booking`) — legal-approved policy

**Locked decisions (from Phase 28, reused):** Gregorian calendar + Persian month
names (`fa-IR-u-ca-gregory`); Persian digits in prose/dates/counts, **Latin for
money / account numbers / IDs / reference codes**; Claude drafts, Yashua reviews
legal/policy copy; acronyms (INZ, PDF, LIA, SWIFT, NZ, MB) kept Latin.

---

## 1. What shipped

- **Foundation helpers** (`lib/money.ts`, `lib/date.ts`):
  - `formatMoney` / `formatMoneyCents` — Latin digits in both locales ("NZD 1,200.00").
  - `relativeTime(value, locale)` — `Intl.RelativeTimeFormat` ("5 minutes ago" /
    "۵ دقیقه پیش"), replacing the per-page English `timeAgo`/`formatWhen`.
- **~200 strings** across **11 files** moved from hardcoded English to `t()` keys,
  in new namespaces: `studentHome.*` (32), `caseMessages.*` (31), `casePay.*` (47),
  `booking.*` (70) + `cancelBooking.*` (16) + `upcomingBookings.*` (8). en/fa parity
  verified for every namespace.
- **Dates** are locale-aware (Gregorian in Persian months + digits); **money** stays
  Latin; **counts** use Persian digits (ICU plurals for slot counts).
- **RTL:** unflipped `→`/`←` arrows now `rtl:rotate-180` or dropped for flipping
  icons; `ml-auto` → `ms-auto`; the case/pay bank accent bar `border-l` → `border-s`.
  The leading-period BiDi artifact is gone (the strings are now RTL-native Persian).

## 2. Legal / policy copy (reviewed & approved)

Went through the review gate (the Phase-28 batch pattern) before shipping:
- **case/pay:** payment-security wording, paid/processing confirmations, the
  processing-times note (kept literal "your booking is confirmed" → «رزرو شما»),
  partner-exchange. **"engagement fee" → «هزینه افتتاح اکانت»** (account-opening-fee).
- **booking:** the cancellation/refund policy (retention 100% / 80% / 20% / 75% / 25%
  with **Persian digits**, the cash-refundable clause) + `CancelBookingButton`.

## 3. Resolved after this phase

- **English "engagement fee" → "Account opening fee"** (follow-up commit). The EN
  source now matches the Persian «هزینه افتتاح اکانت» everywhere it's *shown*:
  `casePay.engagementFee` / `engagementInvoice`, `PaymentsView`, the backend
  `buildNextSteps` label, and the invoice `description` set in `contracts.service`.
  (Internal helper/key names and the `ENG-` invoice prefix keep the old word — that's
  concept-level, not user-facing. Invoices already created with the old description
  keep it; new ones use the new text.)

## 4. Deferred — the next Persian/RTL phase (one scoped piece)

Everything still English in Persian mode is grouped here as **one** future phase to
scope, not scattered follow-ups:

- **Backend-generated copy** — can't be keyed from the frontend; needs the backend to
  return a key / localized text: the booking ineligibility `item.reason` (e.g. "Take
  your free assessment first to unlock consultations") from `GET /booking/eligibility`,
  and the case-message `requestedDocType` enum shown after "Document requested:".
- **Client surfaces not in the four areas:** the wallet page (`WalletClient`), the
  payment-gate panel (`PaymentGatePanel`), the assessment / report view, and the deep
  14-step visa + admission forms (~68 low-visibility form-RTL cosmetics + their strings).
- **Remaining currency / relative-time sites** outside the four areas (`WalletClient`,
  `PaymentsView`) still hardcode `en-NZ` — route them through `formatMoney` /
  `relativeTime`.

## 5. How to test

Set `NEXT_LOCALE=fa` (or toggle the globe) and load each area at 390px:
- **Dashboard** — Persian throughout; amount "NZD 1,200.00" Latin; arrows flip.
- **Messages** — Persian thread + composer; counter "۰ / ۵۰۰۰ (حداقل ۱۰)".
- **case/pay** — Persian pay flow; «صورت‌حساب افتتاح اکانت»; money Latin; the
  ۴–۷ / ۱–۱۰ business-day note in Persian digits.
- **booking** — Persian chooser (3 types), flows, and the cancellation policy.

(Verification screenshots were captured per area; demo seed removed after each.)

## 6. Security / rollback

Frontend-only, display copy — no auth/PII/endpoint/schema change. Each area is an
independent commit; `git revert <hash>` restores that area's English + `en-NZ` dates.
