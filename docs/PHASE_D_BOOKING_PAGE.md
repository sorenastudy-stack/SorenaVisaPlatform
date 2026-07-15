# PR-BOOKING-PAGE — standing Booking chooser in the client portal

A permanent Booking surface at `/portal/booking`, available from the beginning,
that shows ALL THREE session types ALWAYS and consumes the live eligibility
endpoint (`GET /booking/eligibility`, Phase C). Ineligible types render
genuinely disabled with the server's binding reason; eligible types route to the
existing native flows. Also makes the booking calendar always render (empty
greyed scaffold) instead of a text short-circuit.

## 1. What this PR does

- Adds a **Booking** nav entry to BOTH the LEAD and STUDENT arrays in
  `clientShellData.ts` (between Documents and Wallet), inline English label
  (no dot → renders literally per the ClientShell guard), `calendar` icon.
- Replaces `BookingPlaceholder` (bare/unknown `/portal/booking`) with
  `BookingChooser` — all three types always shown; nothing linked to the
  placeholder, so the swap is safe.
- The chooser reads `GET /booking/eligibility`. **Ineligible → real `disabled`
  `<button>` + binding reason beneath. Eligible → `<Link>` to
  `/portal/booking?type=free15|gap|lia`** (the existing working flows). Paid
  types show their price. No-submission → all three dimmed + a nudge to
  `/scorecard`.
- **Calendar always renders:** removed the FreeBookingFlow zero-slots text
  early-return and the PaidBookingFlow inline text branch; both now render
  `EmptyCalendarScaffold` (greyed day-row + time-grid + a quiet
  "No open times in this period" line). Loading/error states unchanged.

## 2. Files changed

**Frontend**
- `src/app/portal/booking/page.tsx` — `BookingChooser` + `BookingTypeCard`
  replace `BookingPlaceholder`; `EmptyCalendarScaffold`; both flows' empty
  states rewired; router points bare/unknown → chooser.
- `src/components/portal/ClientShell.tsx` — `Calendar` added to the icon registry.
- `src/lib/clientShellData.ts` — Booking nav item in both arrays.

Consumes the existing `src/lib/booking/eligibility.ts` (Phase C) — no new client
lib. **No backend change, no schema, no migration.**

## 3. Schema added

**None.** Pure consumer of Phase C's `GET /booking/eligibility`.

## 4. Endpoint contract

No new endpoint. Reads `GET /booking/eligibility` (Phase C): per-type
`{ type, eligible, reason, paid, priceNzd }` + `hasSubmission` + `primaryType`.
The chooser renders `types[]` in fixed order FREE_15 → GAP_CLOSING → LIA.
Eligible types navigate to the existing `POST /booking/confirm` (free) and
`POST /booking/hold` → checkout / pay-with-wallet (paid) flows.

## 5. Configuration

None. Colours/spacing use the existing `sorena-*` Tailwind tokens (navy, gold,
off-white, jade, clay). English-only; **no new `t()` keys, no `fa` entries**
(Persian frozen) — all copy is inline English or server-provided reason strings.

## 6. How to test

**Structural (source assertions):** 15/15 — all three types always mapped (never
hidden); ineligible → real `disabled` attribute + `{item.reason}`; eligible →
`Link` to the typed flow; price shown; no-submission → `/scorecard`; both flows'
empty text-returns removed and `EmptyCalendarScaffold` used; placeholder gone;
nav item in both arrays with an inline (dot-less) label.

**Data + enforcement (backend, `scripts/test-booking-eligibility.ts`, 14/14):**
the eligibility data behind each chooser state — hard stop → FREE_15 blocked with
the hard-stop reason + LIA still eligible; no submission → all three ineligible;
etc. — plus `assertEligible` rejecting ineligible bookings with **403** at
`createFreeBooking` and `createHold`.

**Type safety:** `tsc --noEmit` clean (frontend 0 errors).

_No frontend test runner exists in this repo (no jest/vitest/RTL), so browser
render tests aren't available; the chooser is a deterministic renderer of
runtime-proven data, verified by tsc + structural assertions._

## 7. Known limitations

- The chooser shows type availability (`eligible` + `paid`), not per-slot
  calendar availability — that surfaces in the flow (now as an empty scaffold).
- Eligible-type copy on the card is a short static blurb; the endpoint's richer
  "why this matters" reason is shown for blocked types (the binding case).

## 8. How to extend

- New session type: it appears automatically once Phase C's `types[]` includes
  it — add a `TYPE_META` entry (title/blurb/icon/slug) and it renders in the
  chooser.
- To surface the positive "why this matters" reason on eligible cards too, read
  `item.reason` in the eligible branch.

## 9. Security layers applied

- **Display-only page.** Eligibility is ENFORCED server-side by
  `assertEligible` in `createFreeBooking` / `createHold` (Phase C) — a dimmed
  button forced clickable in devtools still hits a **403** (proven: backend
  tests 8-9). Confirmed holds.
- **Own data only.** `GET /booking/eligibility` reads `req.user.userId`; it never
  accepts a `userId` param, and is `@Roles('LEAD','STUDENT')` + rate-limited.
- Eligible actions navigate to the existing guarded booking flows; no new write
  path introduced here.

## 10. Rollback procedure

- **Code:** revert the commit. The nav entry, chooser, and empty-scaffold change
  disappear together; `/portal/booking?type=…` typed flows are untouched.
- **Schema:** none.
- **Order:** frontend-only; no deploy ordering constraint. (Depends on Phase C's
  endpoint already being live — it is.)
