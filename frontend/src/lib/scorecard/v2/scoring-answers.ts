// PR-PHASE33 — build the scoring answer set from the redesigned (v2) assessment
// form state, producing a qNN map byte-identical to what the current form yields.
//
// The v2 form stores every SCORED field under its existing qNN key (compound
// questions are just visual groupings whose sub-selects each write their own
// key), EXCEPT the two field-of-study questions which use the StudyField
// taxonomy: Q13 (qualification field → q16) and Q32 (preferred fields → q25).
// Those are derived here via study-field-maps. Then the existing
// fillHiddenAnswers() applies the same canonical fallbacks for hidden
// conditionals — so the assembled set scores identically (guarded by the backend
// CI gate, scoring.spec.ts).

import { fillHiddenAnswers } from '../submit-helpers';
import { STUDYFIELD_TO_Q16, STUDYFIELD_TO_Q25 } from './study-field-maps';

export type V2State = Record<string, string | string[] | boolean | number | null | undefined>;

const QNN = /^q\d{2}_/;

export function buildScoringAnswers(state: V2State): Record<string, string> {
  const a: Record<string, string> = {};

  // 1. Copy every directly-captured scored field (qNN keys), skipping the two
  //    that are derived from StudyField selections below.
  for (const [k, v] of Object.entries(state)) {
    if (!QNN.test(k)) continue;
    if (k === 'q16_field_main' || k === 'q25_intended_study') continue;
    if (v == null || v === '') continue;
    a[k] = String(v);
  }

  // 2. Q13 (qualification field, StudyField) → q16 scored option.
  const q13 = state.q13_qualification_field;
  if (typeof q13 === 'string' && q13) {
    a.q16_field_main = STUDYFIELD_TO_Q16[q13] ?? 'Other';
  }

  // 3. Q32 (preferred fields, StudyField multi) → q25 (primary preference).
  //    Only 'Other' vs non-'Other' affects scoring (HS2).
  const prefs = state.q32_preferred_fields;
  const primary = Array.isArray(prefs) && prefs.length > 0 ? String(prefs[0]) : null;
  a.q25_intended_study = primary ? (STUDYFIELD_TO_Q25[primary] ?? 'Other') : 'Other';

  // 4. Apply the SAME conditional fallbacks the live form uses before submit.
  return fillHiddenAnswers(a);
}
