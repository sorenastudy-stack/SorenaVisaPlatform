# Phase 37: Assessment Multi-Step UX

Session of 2026-08-08. Handover document — written so the next session, or Yashua reading it
alone, can pick up without needing the conversation.

**Shipped in one commit:** `0ac7756` — 8 files, +853 / −63. Frontend only. No migration, no
schema change, no production data touched.

---

## 1. What this phase does

`/assessment` presented all 58 fields on a single page. It is now **eight steps**: seven content
sections plus a declaration, matching the shape of the live `/scorecard` it is meant to replace.

1. **Seven content steps + a declaration.** `Readiness & Timeline` was merged into `Finances`,
   now `Finances & Readiness`.
2. **Per-step validation.** Next is gated on the current step; Back never validates; errors
   render under the field they belong to.
3. **A full re-validation before submit**, which catches conditional fields that only became
   required because of a later answer, and returns the applicant to the step holding them.
4. **A clickable progress bar** limited to steps already reached.
5. **Autosave carries the step**, so a refresh resumes where the applicant was.
6. **A declaration step** with a confirmation checkbox, gating Submit.

### Why the merge, specifically

`Readiness & Timeline` had three fields. On its own that is a whole step — progress bar, Next
button, three questions — which reads as clicking for the sake of clicking. The pairing with
Finances is not only about size: both halves ask *"can you actually act?"*, in money, paperwork,
and timing. The live `/scorecard` reached the same grouping independently; its section 3 is
"Financial & operational readiness".

**No scored key changed.** A test asserts all three timeline keys (`q39_passport`,
`q40_docs_ready`, `q41_apply_timeline`) survived the merge, so a later tidy-up cannot quietly
drop a scored question.

---

## 2. Files created or changed

**New**
| File | What it is |
|---|---|
| `frontend/src/lib/scorecard/v2/assessment-steps.ts` | Step model + validation. Pure, no React. |
| `frontend/src/components/common/FormProgress.tsx` | Progress bar and step dots. |
| `frontend/src/app/assessment/assessment-steps.test.tsx` | 21 tests. |

**Changed**
| File | Change |
|---|---|
| `frontend/src/app/assessment/page.tsx` | Step state, navigation, per-step + final validation, declaration, response-shape guards. |
| `frontend/src/lib/scorecard/v2/assessment-v2.ts` | Sections merged 8 → 7 and renumbered. |
| `frontend/src/lib/scorecard/v2/assessment-draft.ts` | `DRAFT_VERSION` 1 → 2; `step` documented as real. |
| `frontend/src/app/assessment/assessment-autosave.test.tsx` | Updated for the multi-step shape. |
| `frontend/src/app/assessment/assessment-picker.test.tsx` | Same. |

Both updated suites derive their step index from the schema (`findIndex(s => s.title === …)`)
rather than hard-coding a number, so re-ordering sections cannot silently turn them into
"the control was never rendered" passes.

---

## 3. Database tables/columns added

**None.** Autosave writes to the browser's `sessionStorage`, as established in Phase 36. No
draft table, no retention policy, and no half-finished answers about health or criminal history
stored server-side for a visitor who never submitted.

`DRAFT_VERSION` went 1 → 2 because `step` changed meaning: a v1 draft always carried `0`,
written by a single-page form to mean "not applicable", which a multi-step form would read as
"resume at step 1". It happens to be harmless, but relying on a coincidence is how the *next*
change breaks, so v1 drafts are discarded.

`clampStep()` additionally keeps a restored index inside the current form. This is separate from
the version gate on purpose: **the step count can change without any answer changing** — merging
two sections did exactly that — and no version bump would have been prompted by it.

---

## 4. Environment variables added

**None.**

---

## 5. Third-party services connected

**None.**

---

## 6. How to test it works

**Automated** — all green at `0ac7756`:

```bash
cd backend  && npx jest src/scorecard/scoring/scoring.spec.ts   # 47/47
cd frontend && npx vitest run                                    # 50/50
cd frontend && node scripts/verify-v2-scoring.cjs                # BYTE-IDENTICAL: true
cd frontend && npx tsc --noEmit && npm run build                 # clean
```

Scoring is untouched by design; all three layers were re-run to prove that, not because a change
was expected.

**Both gates were checked against the code they guard:**
- Disabling the per-step check → 3 tests fail.
- Disabling the final full check → the conditional-field test fails.

**Manual — browser verification at 820px and 375px.** Five states were captured: step 1, a
middle step with the married conditionals revealed, a refused Next, the declaration, and mobile.
Horizontal overflow at 375px measured **0px**; all eight dots fit one row.

This is where three defects were found that no test caught — see §7.

---

## 7. Known limitations

**Three defects were found by the browser pass and FIXED in this commit.** Recorded because each
is a class of bug worth watching for:

1. **`fields.find is not a function` — a white screen on a public form.** When
   `/api/assessment/study-fields` answers with an error *object* rather than an array, `.catch()`
   does not fire (the promise resolved fine), `fields` stops being an array, and render throws.
   **Pre-existing**, dating from before this phase; invisible because every test mocked the
   endpoint into returning an array. Both this and `allowed-fields` now check the shape, each
   with a test.

2. **Progress dots ticked steps that were merely reached.** Resuming a draft parked at step 8
   marks all seven earlier steps "reached"; a reached-means-done tick promised seven finished
   steps to someone who had answered one, then bounced them backwards on submit. A tick now
   means the step's answers are actually present.

3. **Single-field questions rendered their label twice** — once as the card heading, once above
   the control. Hidden with `sr-only`, not dropped: the control still needs an accessible name.

Also fixed here: the country and phone fields **lost their label association** in Phase 36 when
those branches moved from `<label>` to `<div>`, leaving both controls unnamed to a screen reader.
Caught by a test that could no longer find them by label.

**Still open:**

- **The declaration is not recorded anywhere.** It gates Submit and nothing more — no timestamp,
  no stored consent, no audit entry. If it is ever needed as evidence that an applicant
  confirmed their answers, that is a backend change, not a UI one.
- **Errors are text-only; the field itself is not outlined.** The message appears under the
  control but the input keeps its normal border. Fine at five fields per step, worth revisiting
  if a step grows.
- **The 50 frontend tests still do not run in CI.** Carried over from Phase 36 and now covering
  considerably more. Until this is wired up, a push can break the assessment without anything
  going red.
- **No keyboard-only pass has been done** on the step dots and the two searchable pickers.
  Unreached dots are correctly not focusable, but tab order through a whole step has not been
  walked.

---

## 8. How a future developer would extend this

**Adding or re-ordering a section.** Edit `ASSESSMENT_V2`; `TOTAL_STEPS`, `STEP_TITLES` and
`DECLARATION_STEP` all derive from its length, and `clampStep()` protects drafts pointing past
the new end. Nothing else needs touching.

**Adding a validation rule.** One place: `checkField()` in `assessment-steps.ts`. Both the
per-step gate and the final sweep run through it, so they cannot diverge.

**Splitting a step that has grown.** `About You` is the largest at 13 fields, but 5 are
conditional — a single applicant with no partner or children sees about 8. Measure what a real
applicant sees before splitting on the raw count.

**Do not extract `FormProgress` into `/scorecard`.** The duplication is deliberate: `/scorecard`
is receiving real leads, and it is deleted the moment `/assessment` replaces it, at which point
the shared abstraction would have one consumer again. The reasoning is in the component header.

**If the declaration needs to be legally meaningful**, it needs a backend field — the checkbox
currently exists only in React state and is not sent with the submission.

---

## 9. Security layers applied

**No new attack surface.** No new endpoint, no new stored field, no change to what is persisted
or to any authorisation check.

**Two response-shape guards added** (§7.1). An endpoint answering with an unexpected shape now
degrades to an empty list instead of throwing inside render. A white-screened public form is
both an availability problem and a support problem — the applicant sees nothing, and there is
nothing in the UI to retry with.

**Validation is client-side only and is not a trust boundary.** The step gates are a UX
affordance; the scoring engine and matcher remain server-authoritative, exactly as before.

**Consent is gated but not recorded** (§7). Submit cannot proceed unattested, but nothing proves
after the fact that it was attested.

---

## 10. Rollback instructions

Frontend-only, no data written, so rollback is a plain revert:

```bash
git revert 0ac7756
git push origin main
```

Railway redeploys the frontend service (`ample-dream`) automatically. The backend service is
unaffected.

**One thing to be aware of:** reverting drops `DRAFT_VERSION` back to 1, so any v2 draft in a
visitor's `sessionStorage` is discarded on their next load and they start over. That is the
correct behaviour and needs no action — the draft dies with the tab anyway.

**Nothing else needs undoing.** No migration to reverse, no backfill to re-run.

**Partial rollback** — to keep multi-step but drop the response-shape guards (not recommended;
they prevent a white screen), revert only the two `fetch(...).then(...)` blocks in `page.tsx`.

---

## Commits in this session

| Hash | Message |
|---|---|
| `a6d1317` | feat(forms): session-scoped autosave, and searchable country/phone pickers platform-wide |
| `24b4350` | docs: Phase 36 handover |
| `0d32f0c` | chore(frontend): delete LeadForm — dead code with no route and no live use |
| `6b13e1f` | docs: correct the LeadForm-deletion hash |
| `0ac7756` | feat(assessment): multi-step form with per-step validation and a declaration |

---

## Still pending before `/assessment` can replace `/scorecard`

- ~~Session-scoped autosave~~ — done, Phase 36
- ~~Country and phone pickers~~ — done, Phase 36
- ~~Multi-step UX~~ — **done this phase**
- Validation polish — the rules are in place; what is left is field-level styling and a
  keyboard pass (§7)
- ~12 UI strings to Persian + an RTL pass (the scorecard *questions* explicitly do **not** need
  translating)
- The result-gate decision
- AI foundation + Recommendation Explanation Agent
- Programme enrichment data
- Wiring vitest into CI

## Other open items (unchanged)

- Seafield's 2 deferred programmes — needs the importer to update in place
- 4 institutions without coordinates
- The unexplained 2026-08-05 Future Skills activation
- Bulk-activate button (top follow-up in the curation phase doc)
- The marketing site's lead form may share the empty-option enum bug recorded in the Phase 36
  doc — cannot be checked from this repo
- Remaining launch work: OPS portal, Sales portal, legacy `/admin/*`, Student portal My Case /
  Payments, client portal polish
