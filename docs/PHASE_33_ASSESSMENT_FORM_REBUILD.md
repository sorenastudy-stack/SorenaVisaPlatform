# Phase 33 — 31-question assessment form rebuild (built, NOT live)

Builds the redesigned ~31-question assessment (Phase 32 spec) as a working,
verified flow behind a **new `/assessment` route**. It does **not** replace the
live `/scorecard` form — that switch is a separate future decision, gated on the
AI foundation + Recommendation Explanation Agent being ready.

**Date:** 2026-07-30
**Status:** built + verified; **not live** (live `/scorecard` untouched).

---

## 1. What it does

At the end of Step 1 the applicant gets, on one screen: (a) their **eligibility +
band**, and (b) a **ranked list of recommended programmes** each with a
"why this fits" breakdown — the Phase 32 vision. Anonymous/pre-account, like the
current scorecard.

## 2. Shipped (all committed + verified)

| Commit | What |
|---|---|
| `5b800ad` | v2 mapping (`lib/scorecard/v2/`): study-field↔scoring maps, `buildScoringAnswers`, `buildMatchCriteria` + **byte-identity guard** (`scripts/verify-v2-scoring.cjs`) |
| `3a3c8ca` | public matching endpoints (`/public/matching/{recommendations,study-fields,allowed-fields}`) |
| `a46f39a` | v2 form + result flow (`/assessment`), 4 Next proxies, backend `POST /scorecard/public/score-preview` |

### The byte-identical guarantee (the compliance point)
The "31 questions" are the **same 52 scored fields reorganised into 31 UI groups**
(compound questions = visual groupings whose sub-selects each still write their own
`qNN` key) + new preference/nationality fields. Only Q13 (qualification field) and
Q32 (preferred fields) use the StudyField taxonomy; they derive `q16` / `q25` via
`study-field-maps.ts` (same weights). `buildScoringAnswers` assembles the qNN set
and applies the existing `fillHiddenAnswers`, so scoring is **byte-identical**.

**Proof:** `frontend/scripts/verify-v2-scoring.cjs` runs the frozen reference
battery (Maryam 100/BAND_6, borderline-gate cat2=13, all 6 hard-stops) through
`buildScoringAnswers` → the REAL backend engine → asserts the golden output.
**7/7 byte-identical.** Complements the backend CI gate (`scoring.spec.ts`).

### Q30 field-relatedness (Q32)
Q32's selectable fields = the **server-authoritative** allowed set
(`GET /public/matching/allowed-fields?qualificationFieldId=`), which reuses the
matcher's `allowedFieldIds`. The UI filters to exactly that set + shows the
explanatory note; it can never diverge from the matcher (which also re-derives it,
bypass-proof).

### Scoring/matching on submit
`buildScoringAnswers` → `POST /scorecard/public/score-preview` (same engine,
byte-identical, **no lead created / nothing persisted**) for band + eligibility;
`buildMatchCriteria` → `POST /public/matching/recommendations` for the ranked list.
`whyThisFits` is the **deterministic** version (dimension → sentence) — the LLM
Recommendation Explanation Agent that renders richer prose is deferred (below).

## 3. Verification done
- `frontend tsc --noEmit` clean.
- Byte-identity guard 7/7 (reference battery → real engine).
- Live backend: `score-preview(Maryam)` = 100/BAND_6/eligible; `study-fields` = 19;
  `allowed-fields(engineering)` = 7 (self + IT + trades + all Management); matching
  service smoke earlier confirmed Q30 exclusion + approved-only + scholarships.
- Live `/scorecard` form + its `qNN` keys untouched.

## 4. Deferred / to go live

1. **AI foundation** (context engine, prompt governance, `AiEvent` log) + the
   **Recommendation Explanation Agent** — replaces the deterministic `whyThisFits`
   with Persian/English prose. Yashua's gate for going live.
2. **Going live** — when approved: point the funnel at `/assessment` (or swap the
   `/scorecard` route), decide whether to keep `score-preview` (shows the result
   pre-account) or keep the current "create account to see result" gate, and add
   i18n (the v2 form is English-only for now — the Phase 28–30 next-intl patterns
   apply).
3. **Programme enrichment data** — descriptions/career (AI-seeded→approved) +
   rankings (staff-entered) must be populated for rich recommendations; the seed
   ships the taxonomy + relations only.
4. **Polish** — the v2 form is functional (single-page, basic styling, English);
   before live it should get the current form's multi-step UX, autosave,
   validation polish, country pickers, and Persian.
5. **Pre-existing schema-drift cleanup** (from Phase 32) — still separate.

## 5. How to test
- `cd frontend && node scripts/verify-v2-scoring.cjs` (needs `cd ../backend && npm run build`) → 7/7 byte-identical.
- `cd backend && npm run seed:study-fields` then run backend + frontend; visit `/assessment`.
- Live `/scorecard` continues to work unchanged.

## 6. Security / rollback
New route + additive backend endpoints; the live funnel is untouched. The public
endpoints only expose APPROVED programme data and never persist from the preview.
`git revert` any commit to back out that piece.
