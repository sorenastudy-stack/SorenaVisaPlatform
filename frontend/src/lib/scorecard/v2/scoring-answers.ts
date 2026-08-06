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

/** Minimal shape of a StudyField as the form receives it from the server. */
export interface StudyFieldRef {
  id: string;
  key: string;
}

const QNN = /^q\d{2}_/;

/**
 * Thrown when a StudyField selection cannot be mapped to a scored option.
 *
 * This is deliberately NOT a silent fallback to 'Other'. 'Other' is itself a
 * legitimate choice (`other` is a real StudyField key), so a silent fallback
 * makes "we could not resolve this" indistinguishable from "the applicant chose
 * Other" — which is exactly how the id/key mismatch below went unnoticed: the
 * picker emits a cuid, the map is keyed by key, every lookup missed, and every
 * applicant silently scored 0 for field of qualification.
 */
export class StudyFieldResolutionError extends Error {
  constructor(value: string, which: 'q13_qualification_field' | 'q32_preferred_fields') {
    super(
      `Cannot map ${which} value "${value}" to a scored option. ` +
      'Expected a StudyField key, or an id resolvable against the supplied studyFields list.',
    );
    this.name = 'StudyFieldResolutionError';
  }
}

/**
 * Resolve a picker value to a StudyField KEY.
 *
 * The form stores the StudyField **id**, because that is what the server's
 * matching contract expects (`qualificationFieldId // Q13 → StudyField id`) and
 * what `allowed-fields` is queried with. The scoring maps, however, are keyed by
 * the StudyField **key**. This is the boundary where the two meet.
 *
 * Accepts either form so the frozen reference battery (which is written in keys,
 * because keys are stable and cuids are not) keeps working unchanged.
 */
function toStudyFieldKey(
  value: string,
  studyFields: StudyFieldRef[] | undefined,
  which: 'q13_qualification_field' | 'q32_preferred_fields',
): string {
  // Already a key the scoring maps know.
  if (value in STUDYFIELD_TO_Q16) return value;
  // Otherwise it should be an id from the server-supplied list.
  const match = studyFields?.find((f) => f.id === value);
  if (match && match.key in STUDYFIELD_TO_Q16) return match.key;
  throw new StudyFieldResolutionError(value, which);
}

export function buildScoringAnswers(
  state: V2State,
  studyFields?: StudyFieldRef[],
): Record<string, string> {
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
    a.q16_field_main = STUDYFIELD_TO_Q16[toStudyFieldKey(q13, studyFields, 'q13_qualification_field')];
  }

  // 3. Q32 (preferred fields, StudyField multi) → q25 (primary preference).
  //    Only 'Other' vs non-'Other' affects scoring (HS2), but an unresolvable
  //    value here would wrongly read as 'Other' and can FIRE a hard stop for a
  //    High School applicant, so it is resolved just as strictly.
  const prefs = state.q32_preferred_fields;
  const primary = Array.isArray(prefs) && prefs.length > 0 ? String(prefs[0]) : null;
  a.q25_intended_study = primary
    ? STUDYFIELD_TO_Q25[toStudyFieldKey(primary, studyFields, 'q32_preferred_fields')]
    : 'Other';

  // 4. Apply the SAME conditional fallbacks the live form uses before submit.
  return fillHiddenAnswers(a);
}
