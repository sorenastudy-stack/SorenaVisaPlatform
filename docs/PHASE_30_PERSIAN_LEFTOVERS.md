# Phase 30 — Consolidated Persian / RTL leftovers

Everything that was still English in Persian mode after Phase 29's §4: the two
backend-generated strings, the four not-yet-translated surfaces (wallet,
payment-gate, assessment/report, the 14-step visa + admission forms), and the
leftover `en-NZ`-hardcoded currency / date sites. Shipped **per area**, one
commit each (+ a couple of split sub-commits for the large forms area), all
`tsc --noEmit` clean with en/fa key parity verified per namespace.

**Date:** 2026-07-29

**Commits** (in order):
- `02adc80` — portal surfaces: wallet, payment-gate, payments
- `62d4255` — booking ineligibility `reasonCode` (backend → Persian)
- `c24699f` — assessment report (`ScorecardResultClient`, shared with public scorecard)
- `f6cac32` — forms 5a: fill 44 blank/English admission + visa-education fa keys
- `16b2349` — forms 5b: the two visa uploaders + admission shell/footer toasts
- `398e3c1` — forms 5c: admission Step 1 (study) — month labels + UI
- `3df01cf` — **legal: INZ + Sorena declarations stay English** (decision #4)
- `184dbad` — forms 5d: Step 8 relationships validation toast + admission upload sizes
- `b9cc893` — forms 5e: remaining visa upload file sizes → `formatBytes`
- `2d59645` — forms 5f: RTL cosmetics (asterisks, bullet indents)

**Locked decisions (carried from Phases 28–29):** Gregorian calendar + Persian
month names (`fa-IR-u-ca-gregory`); Persian digits in prose/dates/counts, **Latin
for money / account numbers / IDs / reference codes**; acronyms (INZ, PDF, LIA,
NZD, MB, PDF/JPG/PNG/DOCX) kept Latin; Claude drafts Persian, Yashua reviews
chrome + legal/policy copy; **"Account opening fee"** is the correct term.

**Phase-30 decisions (confirmed by Yashua):**
1. `requestedDocType` (case-message doc request) — **left as staff-entered
   content, not translated.**
2. `ScorecardResultClient` — translated; covers **both** `/portal/report` **and
   the public `/scorecard/result`** (shares the same component + root locale
   provider).
3. `PaymentsView` — folded in with the other three portal surfaces.
4. **Legal boundary = "all statutory text":** every INZ question / obligation /
   declaration in visa Steps 4/5/9/12 + the admission declarations renders
   **English even in Persian mode**; ordinary field labels, section titles,
   option labels, buttons and validation toasts stay Persian.
5. Assessment **"Band N"** stays **Latin** in both locales (brand/classification
   term), including the "Band" caption.

---

## 1. The two backend-generated strings

- **Booking ineligibility `reason`** — now solved with a stable **`reasonCode`**.
  `booking-eligibility.service.ts` adds `reasonCode` (a fixed 11-value union) +
  optional `reasonParams` to every `TypeEligibility`; the English `reason` stays
  as a fallback. Frontend `lib/booking/eligibility.ts` mirrors the fields and
  exposes `reasonText(item, t)` → `t('booking.reasons.<CODE>')`, reused by the
  standing booking page **and** `ScorecardResultClient` so both render identical
  Persian. The dynamic Gap band-mismatch sends `{ band: "Band 3" }` (Latin).
  *Policy note:* these reasons name the LIA / "legal issue on your file" — copy
  is in `booking.reasons.*` for Yashua's review.
- **`requestedDocType`** — **left English (staff content)** per decision #1.

## 2. What shipped, by surface

| Area | Namespace(s) | Notes |
|---|---|---|
| Wallet (`WalletClient`) | `wallet.*` | credit-policy line reuses the approved B5/B13 wording; money → `formatMoneyCents` (Latin), dates → `formatDate(locale)`. |
| Payment-gate (`PaymentGatePanel`) | `paymentGate.*` | now an async server component; "engagement letter" → «قرارداد همکاری», locked state → account-opening terminology. |
| Payments (`PaymentsView` + both page wrappers) | `paymentsView.*` | client component; Stripe status mapped; a pre-existing duplicate top-level `"payments"` key was shadowing the namespace → renamed to `paymentsView`. |
| Assessment report (`ScorecardResultClient`) | `scorecard.*` (result/bands/categories) | shared with public scorecard; band names + category names via `t()`; "Band N" Latin. |
| Visa + admission forms | flat `admission*` / `visa*` + nested `visaStep8` | ~90 % were already `t()`-wired; 5a filled 44 blank/English fa keys, 5b–5f wired the ~90 remaining hardcoded strings. |

## 3. Shared helpers / foundation

- `lib/bytes.ts` — **new** `formatBytes(bytes, locale)`: Persian digits + Latin
  unit ("۱٫۵ MB"). Now used by all five file uploaders (2 visa multi-file, visa
  photo, visa document, admission).
- `formatMoney`/`formatMoneyCents` extended to the wallet + payments + scorecard
  sites (were ad-hoc `en-NZ` / manual formatters).
- `formatUploadedAt(iso, locale)` (exported from `DocumentMetadataPicker`) — the
  compact "DD/MM HH:MM" upload stamp, localised; replaced two duplicate Latin-only
  `formatSize`/`formatTime` helpers.
- Admission Step-1 intake labels + `formatDate(…, locale)` everywhere they were
  called without a locale.

## 4. Legal / compliance — "stays English" (commit `3df01cf`)

**53 statutory keys** now have their `fa.json` value set to the English source
verbatim, so a Persian-mode user sees them in English while the rest of the page
is Persian. The full allowlist is in the commit + `scratchpad/revert-legal.cjs`:

- **Step 4 Character (14):** convictions / investigation / deportation /
  refused-visa questions, police-certificate obligations, the "lived 5+ years"
  and other-citizenships questions.
- **Step 9 Background (10):** INZ 1200 Q1–Q10 (war crimes, human-rights abuses,
  armed conflict, detention, …).
- **Step 5 Health (21):** TB/renal/medical-condition/residential-care/pregnancy
  questions, TB-risk + medical-exam obligations, the insurance + public-health
  declarations.
- **Step 12 (2):** authority-to-submit-on-your-behalf + its help text.
- **Admission (6):** the agent statutory declaration (Step 7), the submit terms +
  privacy/data-sharing + consent + acceptance (Step 8, P1–P4 + acceptance label).

The prominent multi-paragraph declaration blocks (admission Step 7/8, visa health
insurance) get `dir="ltr"` so the English reads left-aligned inside the RTL page
(a no-op in English mode). Inline statutory **question labels** (character /
background / health) render English but are not individually `dir`-wrapped — an
English sentence renders as a single LTR run and reads correctly (right-aligned
in RTL). Extending `dir="ltr"` to those inline labels is an optional polish
follow-up.

> If Yashua wants the boundary wider/narrower, edit the allowlist in
> `scratchpad/revert-legal.cjs` and re-run, or move keys in/out of the set.

## 5. Review-gate flags (Persian copy Yashua should read)

- **`booking.reasons.*`** — LIA / "legal issue on your file" wording.
- **`scorecard.result.malaysiaBody`** — the fee-disclosure ("USD 200 account
  opening fee", INZ visa fee) and **`scorecard.bands.*`** band names (marketing).
- **`wallet.creditPolicy`** — financial policy (reuses already-approved B5/B13).
- **`paymentGate.*`** — payment-confirmation reassurance (mild).
- The 53 legal keys themselves — **English, no translation to review** (that's the
  point of decision #4); Yashua only needs to confirm the *boundary* is right.

## 6. Deliberately left as-is / deferred

- **Backend-generated *data* content on the report** — `nextActionContent` /
  `nextActionTextEn`, hard-stop `name`/`reason`/`resolution`, risk-flag labels,
  5-gate labels, and the user's own answer values stay in their source language.
  Localising these needs backend keying (like the booking `reasonCode` pattern) —
  a future backend change, out of this frontend phase.
- **`PaymentsView` `p.label`** and **wallet `txn.reason`** — backend-authored row
  labels; treated as content (same rule as `requestedDocType`).
- **Two deeper date sites still Latin:** `Step7EmploymentHistory` (manual
  `padStart` month/year) and `Step1IdentityDetails` DOB (`toISOString().slice`).
  Low-visibility; convert to `formatDate(…, locale)` in a follow-up if desired.
- **`RESULT_STRINGS` in `lib/scorecard/labels.ts`** is now unused by the result
  client but kept (still documents the English-only scorecard landing/form).

## 7. How to test

Set `NEXT_LOCALE=fa` (or toggle the globe) at 390 px:
- **Wallet** — Persian throughout; amount "NZD 1,200.00" Latin; policy line Persian.
- **Payments** (`/portal/payments`, `/student/payments`) — Persian; status pills; money Latin.
- **Documents gate** — the three payment-gate tones in Persian.
- **Assessment** (`/portal/report`, public `/scorecard/result`) — Persian chrome;
  "Band 4" Latin; booking-reason CTAs Persian; next-action prose English (backend).
- **Booking** (`/portal/booking`) — ineligibility reasons now Persian.
- **Visa Step 4/5/9/12 + admission Step 7/8** — statutory questions/declarations
  render **English** while surrounding labels/titles are Persian; declaration
  blocks left-aligned.
- **Forms uploaders** — file sizes "۱٫۵ MB" (Persian digits, Latin unit); Step 1
  intake "مارس ۲۰۲۷".

### Live verification (follow-up)

The backend build issue was **a stale incremental-build cache**: a root
`tsconfig.build.tsbuildinfo` recorded `main.ts` as "already emitted", so
`nest build` (with `deleteOutDir`) re-created `dist/` but skipped `dist/main.js`,
leaving `node dist/main` → `MODULE_NOT_FOUND`. Fix: `rm tsconfig.build.tsbuildinfo`
(+ `dist/`) then rebuild — `dist/main.js` emits and the API boots on `:3001`.
*(If it recurs after a partial/interrupted build, clear that tsbuildinfo.)*

With the backend up + the demo student seeded (`seed-demo.cjs` → paid student;
`seed-visa-state.cjs` → admission app so the visa section unlocks + `currentStep`
bumped so all steps are reachable), a live Persian (`NEXT_LOCALE=fa`, 390 px) pass
on **visa Step 9 (Background)** confirms decision #4 visually: the page chrome is
Persian (title «بخش ویزا», section «اطلاعات سوابق», subsection titles, Yes/No
«بله»/«خیر») while the **INZ 1200 statutory questions render in English**
(religious/cultural position, political appointment, ill-treatment of prisoners,
war crimes, detention). Automated assertion: Q5/Q8/Q10 English text + Persian
section-title + Persian Yes/No all present in one `rtl/fa` page.
(Screenshots: `scratchpad/shots-p30/visa-step9-fa*.png`.)

Also verified structurally via `tsc --noEmit` + per-namespace en/fa parity — which
caught the duplicate-`payments` shadowing bug that would have crashed the payments
page at runtime.

## 8. Security / rollback

Frontend display copy + one additive backend field (`reasonCode`, with the
English `reason` preserved as fallback) — no auth/PII/endpoint/schema change.
Each area is an independent commit; `git revert <hash>` restores that area.
