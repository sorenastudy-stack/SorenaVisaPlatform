# Phase 32 — Assessment redesign + Matching Engine

Redesign the readiness assessment (52 → ~31 questions, Option A: **scoring engine
unchanged**) and build a programme **Matching Engine** that, at the end of Step 1,
returns a ranked recommendation list with a per-item "why this fits" breakdown —
constrained by the **Q30 academic-progression rule**.

**Date:** 2026-07-30
**Status:** foundation shipped (backend); frontend + AI agent deferred to a
dedicated session (see §4).

---

## 1. Locked design decisions (approved before build)

- **Option A — scoring stays byte-identical.** The ~31-question set is reached by
  *merging* questions (each compound UI question writes the same underlying answer
  keys) + dropping only 0-scored fields + deriving q26. No scored input is
  removed, so `score()`, all 6 hard-stops, the 5 gates, and the risk flags are
  unchanged. (We rejected a leaner ~29-Q variant after the harness showed cutting
  a cat-2 question flips execution eligibility for a borderline applicant.)
- **StudyField taxonomy** (canonical field vocabulary) tags both the questionnaire
  and programmes; a directed **StudyFieldRelation** graph encodes the Q30 rule.
- **Q30 rule:** at Q32 (preferred field) the applicant may pick only fields
  *related to their prior-qualification field* (Q13) **or** any field in the
  always-selectable **"Management & Business"** category. Q13 = Other → Management
  only + a "request another field → staff" path. Enforced in the UI **and**
  re-derived server-side in the matcher (bypass-proof).
- **Enrichment v1 = rich:** programme descriptions + career outcomes (AI-seeded →
  staff-approved); **rankings are STAFF-ENTERED only** (never AI-invented).
- **CI gate:** a frozen reference battery is the permanent guard that scoring
  stays byte-identical on any future questionnaire/weight edit.

## 2. Shipped this session (backend, all tested + committed)

| Commit | What | Verification |
|---|---|---|
| `f04b9bc` | **Golden CI gate** — reference battery (Maryam 100/BAND_6, borderline-gate cat2=13, all 6 hard-stops) frozen in `scoring.spec.ts`; asserts full total/band/eligibility/hard-stops | 47/47 green |
| `66c30ef` | **StudyField schema** — `StudyFieldCategory`, `StudyField` (backgroundWeight preserves q16; reserved video columns), `StudyFieldRelation`, `ProgrammeStudyField` + programme/provider enrichment (`descriptionEn/Fa`, `careerOutcomes`, `highlights`, `ranking*`), all reviewStatus-gated | applied via isolated additive migration; tables verified |
| `3f95e0b` | **Matching Engine core** (`matching.logic.ts`) — `allowedFieldIds` (Q30), `passesHardFilter` (bypass-proof, approved-only, level/GPA/English/budget), `softScore`, `whyThisFits`, `rankRecommendations` | 13/13 unit tests |
| `a99a15e` | **StudyField seed** (11 categories / 19 fields / 12 relations) + **MatchingService/Controller/Module** (`POST /matching/recommendations`, JwtAuthGuard) | nest build clean; 60/60 tests; runtime smoke green |

**Runtime smoke (service against seeded DB):** an Engineering-background applicant
gets the IT programme (eng→it edge allowed, approved) with its IR-nationality
scholarship and a full `whyThisFits`; an Arts programme is **excluded** (Q30
disallowed), and a PENDING programme is **excluded** (unapproved) — every
guarantee holds end-to-end.

### Key files
- `backend/src/scorecard/scoring/scoring.spec.ts` — CI gate.
- `backend/prisma/schema.prisma` + `prisma/migrations/20260730010000_phase32_studyfield_taxonomy/`.
- `backend/src/matching/{matching.logic.ts, matching.service.ts, matching.controller.ts, matching.module.ts, dto/}` (+ `.spec.ts`).
- `backend/scripts/seed-study-fields.ts` (`npm run seed:study-fields`).

## 3. The ~31-question set (reference)

5 contact + 29 assessment across 8 sections. Every compound question writes the
current scored keys (byte-identical). The full mapping table — including which
`qNN` keys each question writes, and the Q30 constraint on Q32 — is the approved
spec captured in the conversation/handover; the CI gate enforces the key set.
New (non-scored) inputs: nationality (Q5), preferred field(s) multi-select (Q32),
desired level (Q33), tuition budget (Q34), work-while-studying (Q36).

## 4. Deferred — to a dedicated future session

1. **31-question frontend form rebuild** — replace the scorecard form; write the
   exact scored keys (guarded by the CI gate) + capture nationality/preferences/
   StudyField; wire Q32 to `allowedFields(Q13)` with the filter + explanatory note.
   Then derive `MatchCriteria` from the submission and call the matcher.
2. **AI foundation** (5-part context engine, prompt governance draft→approve→
   deploy, `AiEvent` log with `prompt_version_id`) — **designed but not built**; a
   hard dependency for #3. (Existing plumbing to build on: `ClaudeService`,
   `ComplianceGuardService`, the lead-qualification agent pattern.)
3. **Recommendation Explanation Agent** — renders `whyThisFits` dimensions into
   Persian/English prose via Claude, compliance-guarded, logged. Blocked on #2.
   The deterministic dimensions already exist (matcher output), so the agent is a
   thin, well-scoped layer once the foundation exists.
4. **Programme enrichment data entry** — descriptions/career/rankings are staff-
   entered (rankings) / AI-seeded→approved (descriptions); the owner UI + the
   StudyFieldRelation curation UI are part of this.
5. **Pre-existing schema↔migrations drift cleanup** (separate repo-hygiene task) —
   `prisma migrate dev` currently regenerates a large spurious diff, so Phase 32's
   migration was applied in isolation. Baseline/squash the migration history to
   match the live DB before the next schema change.

## 5. How to test

- `cd backend && npx jest src/scorecard/scoring/scoring.spec.ts src/matching/matching.logic.spec.ts` → 60/60.
- `npm run seed:study-fields` populates the taxonomy.
- `POST /matching/recommendations` with a `MatchCriteriaDto` returns ranked recs
  (only APPROVED programmes from ACTIVE providers; Q30-allowed fields only).

## 6. Security / rollback

Additive only — new tables + nullable/array columns; **no existing data or
scoring behaviour changed** (CI gate proves it). Each increment is an independent
commit; `git revert <hash>` backs out that piece. The matcher never surfaces
unapproved programme/provider/enrichment or a Q30-disallowed field.
