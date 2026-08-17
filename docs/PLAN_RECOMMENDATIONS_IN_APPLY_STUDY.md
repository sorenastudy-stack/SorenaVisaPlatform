# Plan — recommendations inside Apply/Study

**Status:** **Phase 0 and Phase 1 SHIPPED** (17 Aug 2026). Phases 2 and 3 unscheduled.
Originally written 17 Aug 2026 against the code and the production database.

**Owner decision being planned:** recommendations get built into the real Apply/Study flow
(`AdmissionProgrammeChoice` / Step 1), not the separate unused `/student/recommendations` page.

---

## The short version

The scoring engine is reusable as-is and is the easy part. **The plan is dominated by a data
problem, not a code problem** — and one piece of that data has no way in at all today. My
recommendation is to split this into four phases and greenlight only the first two now.

---

## 1. Reusing the scoring, not duplicating it

Today's chain already separates cleanly:

```
resolveMatchCriteria (seam)  →  MatchingService.match()  →  softScore + whyThisFits
                                          ↓
                            RecommendationsService.generate()   ← persistence only
                                          ↓
                            RecommendationList + RecommendationItem
```

`generate()` contains **no scoring**. It resolves the student's criteria through the
`MATCH_CRITERIA_RESOLVER` seam, calls the matcher, and snapshots the result. All the
intelligence is in `matching.logic.ts` (`allowedFieldIds`, `softScore`, `whyThisFits`), which
is pure and takes plain inputs.

**So the reuse is: call the same matcher from the Apply/Study surface.** Concretely —

- Add a `getSuggestionsForCase(caseId)` read path that runs the existing matcher and returns
  ranked programmes. No new scoring code, no copy of `softScore`.
- **Keep `RecommendationList`/`RecommendationItem` as the persistence layer**, rather than
  inventing a second one. It already snapshots `fitScore`, `whyJson`, `institutionType` and
  the resolved criteria for audit, and already supersedes prior lists. Apply/Study becomes a
  *second consumer* of the same generated list.
- The student's actual choices stay in `AdmissionProgrammeChoice`, untouched. A recommendation
  is a **suggestion**; a choice is a **commitment**. Conflating them would be the one genuinely
  irreversible mistake available here.
- Link them with a nullable `AdmissionProgrammeChoice.fromRecommendationItemId` (or similar) so
  we can later answer "do students pick what we suggest?" — additive, no behaviour change.

**Risk:** low. The seam already exists precisely for a second caller.

**One caveat.** The scoring runs against `EducationProgramme` rows, and in production only
**261 of 1,129** are approved and visible. Suggestions will be drawn from that 261 — which is
correct behaviour, but means the quality ceiling is set by the approval queue, not the matcher.

---

## 2. The dormant slot rule — do NOT enable it on today's data

`ProgrammeChoiceRulesService` is built, wired into `admission.service` and
`staff-admission-choices`, and exposed at `GET /public/programme-choice-rules`. It is dormant
only because `CountryExecutionConfig` has no rows, so `slotRules` resolves to
`{ enabled: false }` and `validateChoiceTypeRules` passes everything.

**It must stay dormant until the data supports it.** Production `institutionType`:

| UNIVERSITY | ITP | PTE | not set |
|---|---|---|---|
| **0** | 1 | 72 | 23 |

A mandatory-University slot against that data would be unsatisfiable for every student — the
rule would reject every valid list. A mandatory-ITP slot is satisfiable by exactly one
institution.

**And there is no way to fix it from the app.** While building Part 1 I confirmed
`institutionType` has **no DTO field and no staff UI**. It is only ever set by the CLI bulk
import, derived from which source file an institution arrived in. `UpdateProviderDto` does not
include it; the per-institution panel upload only *reads* it. So this cannot be corrected by
uploading a spreadsheet or by editing an institution in the staff portal.

**Therefore the sequence is forced:**

1. Add `institutionType` to `UpdateProviderDto` + the institution edit screen. Small — half a
   day — but it is a hard prerequisite and nothing else can proceed without it.
2. Categorise the 96 institutions (a data task for the team, not engineering).
3. Only then consider enabling the rule.

**On a data-quality gate:** I would *not* build an automatic one. A gate that silently
switches a mandatory rule on when some threshold is crossed changes what students are allowed
to submit, without anyone deciding. The rule is already explicitly gated — by
`slotRules.enabled` in `CountryExecutionConfig` — and that is the right control: a human turns
it on when the data is ready. What is worth adding is a **read-only readiness indicator** on
the country-config screen ("83 of 96 institutions categorised — 13 still unset"), so the person
flipping the switch can see whether it is safe. Information, not automation.

---

## 3. Seeding `CountryExecutionConfig` for NZ — yes, and separately

There are **0 rows in production**. Every reader is written defensively
(`cfg?.intakeMinLeadMonths ?? 5`), so the 5-month rule, the 12-month window and the 4-month LIA
deadline are all live *on hardcoded fallbacks*. Nothing is broken today.

But two things follow:

- **The Owner-editable knobs have never actually been editable** in effect — changing them in
  the UI writes a row that did not previously exist, which is fine, but nobody has ever done it,
  so that path is unexercised in production.
- **Slot rules cannot be configured at all without a row**, because `slotRules` lives on it.

**Recommendation: seed NZ as its own tiny change, before any of this.** One row, with the
values that are already in force (5 / 12 / 4, `slotCount: 5`, `slotRules.enabled: false`). That
is a **no-op by construction** — it writes down what the code already does — and it converts
the config from theoretical to real, so the first person to change a knob is not also the first
person to create the row. Verify by confirming behaviour is identical before and after.

---

## 4. "Why this fits" — reuse the deterministic version, and say less

The AI explanation agent referenced in `matching.service.ts` (*"deterministic dimensions →
Recommendation Explanation Agent renders prose"*) **does not exist**. `src/ai/agents/` has
content-matching, cv-generation, lead-qualification and video-links. There is no explanation
agent, and no evidence one was started.

What does exist is `whyThisFits()` — a per-dimension breakdown (field match, level, budget,
location, institution weighting) already snapshotted into `RecommendationItem.whyJson`.

**Recommendation: ship the deterministic version, rendered as short labelled chips, and do not
build an AI writer for this.** Reasons, in order of weight:

1. **It is a money-adjacent claim.** A suggestion sits directly beside tuition figures the
   client will pay. A deterministic breakdown is defensible line by line; generated prose
   about someone's eligibility is a claim we cannot audit after the fact.
2. **The inputs are thin.** Fit is computed from field, level, budget and location. Prose would
   be dressing four facts in a paragraph — it would read more confident than the underlying
   data, which is the failure mode to avoid when only 261 programmes are approved and
   `intakeMonths` is empty.
3. **It is reversible.** `whyJson` is already stored per item; a prose layer can be added later
   over the same snapshot without re-generating anything.

If it reads flat in review, the cheaper fix is better *wording of the fixed dimensions*
("Matches your field — Information Technology") rather than a generative step. I would treat
"does this feel right to a client" as a question to answer with a rendered screen in phase 2,
not to pre-empt with an agent.

---

## 5. Size and phasing

Four phases. **My recommendation: greenlight 0 and 1 now; review before 2; treat 3 as a
separate decision.**

| # | Phase | Size | Depends on |
|---|---|---|---|
| **0** | ✅ **SHIPPED.** `institutionType` in the DTO + institution edit screen; NZ `CountryExecutionConfig` seeded; readiness indicator. | ~1 day | — |
| **1** | ✅ **SHIPPED.** Suggestions in Apply/Study, read-only, AFTER the student chooses. 5 suggestions, eligibility-filtered, deterministic "why". | ~3–4 days | — |
| **2** | **Suggestion → choice.** One-tap add from a suggestion into the choice list, provenance link, staff visibility. | **~2–3 days** | phase 1 reviewed with a real screen |
| **3** | **Enable slot rules.** Turn on mandatory institution-type positions. | **~1 day of code** | institutions categorised (a data task, not a code one) |

Phase 3's cost is almost entirely **data, not engineering** — categorising 96 institutions and
deciding the mandatory-slot policy. The code is already written and frozen.

**What I would not do:** build phases 1–3 as one change. Phase 1 puts a new panel in front of
students in a flow they use today, and the honest test of "does the suggestion feel right" is a
real screen with real data — which only exists after phase 1 ships.

---

## Open questions for the Owner

1. **Do suggestions appear before or after the student has chosen anything?** Before is more
   helpful and more leading; after is safer and less useful. This is a judgement about how much
   we steer, and it changes the phase-1 design.
2. **How many suggestions?** `slotCount` defaults to 5, but that is the *choice* count, not the
   suggestion count. They need not match.
3. **Should a suggestion ever be shown for a programme the student is not eligible for**,
   marked as such? Today's matcher hard-excludes them via `allowedFieldIds`. Showing a
   near-miss with "you would need X" is a different, larger feature.
4. **Phase 3 policy:** which positions are mandatory, and which institution type each requires?
   The rule is fully config-driven, so this is a decision, not a build.
   **STILL OPEN — parked, 17 Aug 2026.** Blocked on institution categorisation rather than on
   anything technical: production still holds 23 uncategorised institutions and, until Phase 0,
   no way to fix that existed. Revisit once the catalogue is typed. Questions 1–3 are answered
   and shipped: suggestions appear **after** the student chooses, there are **5** of them, and
   only **eligible** programmes are shown.
