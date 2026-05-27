// PR-SCORECARD-2 — submit-time answer normalisation (Fix 6).
//
// Conditional questions in the form are HIDDEN when their predicate
// fails (see questions.ts `visibleWhen`). At submit time we cannot
// just strip those answers: the scoring engine (sorena_scoring.py)
// awards POINTS for canonical "Not applicable" / "No test taken" /
// "0" responses on several of those fields (e.g. Q7 = "Not applicable"
// awards +2, Q11 = "Not applicable" awards +2, Q5 = "Not applicable"
// awards +2).
//
// The Maryam Karimi unit test passes Q9/Q10/Q11 = "Not applicable"
// and gets the expected 100/Band 6. If the frontend strips them
// entirely the scoring drifts — capped sub-totals still hit their
// ceilings for high-band users, but mid-band users would lose points.
//
// `fillHiddenAnswers` is called by ScorecardForm.tsx IMMEDIATELY
// BEFORE the POST /scorecard/submit. It:
//   1. Copies the answers map (does not mutate the original)
//   2. For every conditional field whose predicate fails, writes
//      the canonical fallback value if the user hasn't already
//      supplied one
//   3. Returns the cleaned-up answers
//
// The autosave (POST /scorecard/draft) path still STRIPS hidden
// answers — drafts are user-visible state, not scoring input.

export function fillHiddenAnswers(
  answers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...answers };

  // Helper — write only when the slot is empty (so a user who
  // back-tracked and previously gave a real answer doesn't have it
  // clobbered).
  const ensure = (key: string, value: string) => {
    if (out[key] === undefined || out[key] === '') out[key] = value;
  };

  // Q4 gender → Q5 military
  // Non-male users → "Not applicable" (+2 pts).
  if (out.q04_gender && out.q04_gender !== 'Male') {
    ensure('q05_military', 'Not applicable');
  }

  // Q6 marital → Q7 / Q8 / Q9 / Q10 / Q11
  const marital = out.q06_marital;

  if (marital === 'Single') {
    // Singles: not asked about a partner OR children. Engine accepts
    // "Not applicable" for Q7/Q9/Q10/Q11 (+2 each, matches Maryam),
    // and "0" for Q8 (+3 pts, also matches Maryam).
    ensure('q07_marriage_years', 'Not applicable');
    ensure('q08_children',       '0');
    ensure('q09_partner_age',    'Not applicable');
    ensure('q10_partner_edu',    'Not applicable');
    ensure('q11_partner_english','Not applicable');
  } else if (marital === 'Divorced' || marital === 'Widowed') {
    // Asked Q7 + Q8 directly (no partner anymore).
    // Q9/Q10/Q11 still need a value for the engine.
    ensure('q09_partner_age',    'Not applicable');
    ensure('q10_partner_edu',    'Not applicable');
    ensure('q11_partner_english','Not applicable');
  }
  // marital === 'Married' → Q7, Q8, Q9, Q10, Q11 all visible — no fill needed

  // Q21 English cert → Q22 / Q23
  // No cert / expired cert → no meaningful score / date. Engine
  // accepts "No test taken" (0 pts for both).
  const cert = out.q21_english_cert;
  if (cert === 'No certificate' || cert === 'Expired certificate') {
    ensure('q22_english_score', 'No test taken');
    ensure('q23_test_date',     'No test taken');
  }

  // Q44 refusal → Q45 / Q46
  if (out.q44_refusal === 'No') {
    ensure('q45_refusal_count',   'Not applicable');
    ensure('q46_refusal_recency', 'Not applicable');
  }

  return out;
}
