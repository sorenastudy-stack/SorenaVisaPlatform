// PR-RECS-1 (slice 1) — deterministic reverse-map from a decrypted /scorecard
// submission to a Matching Engine `MatchCriteria` (Impl A of the
// resolveMatchCriteria seam).
//
// The live /scorecard flow predates the StudyField taxonomy, so it captures the
// applicant's field as a legacy CATEGORICAL STRING (q16_field_main), not a
// StudyField id. This module reverse-maps that option to a StudyField KEY (looked
// up to an id by the resolver). The mapping is intentionally LOSSY and every
// non-1:1 choice is documented — reviewed + confirmed by Yashua (see the
// PR-RECS-1 handover for the full rationale + the C fast-follow that resolves the
// collapsed buckets with a "confirm your specific field" nudge).
//
// Three MatchCriteria fields are DELIBERATELY left empty rather than guessed —
// a wrong HARD filter is worse than a missing soft signal:
//   • preferredFieldIds — q25 is a single coarse field; a lossy guess would wrongly
//     EXCLUDE valid programmes. Empty = all Q30-allowed fields flow through.
//   • desiredLevels     — no source question exists.
//   • tuitionBudgetNZD  — q33 funds-available ≠ tuition budget; a low guess would
//     wrongly CAP OUT programmes.
// C (fast-follow) adds real questions to /scorecard to populate these precisely.

import type { MatchCriteria, QualLevel } from '../matching.logic';

// q16_field_main option → StudyField key (or null when unresolvable). Option
// strings are verbatim from frontend/src/lib/scorecard/questions.ts — do NOT edit
// casing/spacing. Ambiguous buckets pick the BROADEST representative (documented).
export const Q16_TO_STUDYFIELD_KEY: Record<string, string | null> = {
  'Information Technology & Computer Science': 'it_computer_science',
  Engineering: 'engineering',
  'Construction, Trades & Infrastructure': 'construction_trades',
  'Education & Teaching': 'education_teaching',
  'Agriculture & Primary Industries': 'agriculture',
  'Science & Environment': 'science_environment',
  'Aviation, Maritime & Transport': 'aviation_transport',
  'Media & Communication': 'media_communication',
  'Arts, Design & Creative Industries': 'arts_design',
  'Law, Politics & Government': 'law_government',
  'General / Interdisciplinary': 'general_interdisciplinary',
  // Ambiguous → broadest representative (the others are niche specialisations a
  // coarse pick shouldn't presume; broad also widens the Q30 allowed set safest):
  'Healthcare & Medical': 'healthcare_medical',          // not nursing (a profession)
  'Business & Management': 'business_management',         // not project_/healthcare_management
  'Hospitality, Tourism & Culinary': 'hospitality_culinary', // not hospitality_management
  // Unresolvable → null (honest gap; matcher treats as "Other → Business & Mgmt +
  // request-another-field", never a fabricated field):
  'Military & Security': null,           // no StudyField exists
  'Religious & Theological Studies': null, // no StudyField exists
  Other: null,                           // 5 candidates — not a real 1:1 choice
};

export function reverseMapQ16(option: string | undefined | null): string | null {
  if (!option) return null;
  return Q16_TO_STUDYFIELD_KEY[option] ?? null;
}

// q15 "Highest qualification" → canonical QualificationLevel ladder.
// Strings identical to the v2 flow (byte-identical scoring reuses them).
const HIGHEST_TO_LEVEL: Record<string, QualLevel | null> = {
  'High School': null, // below the programme ladder
  Diploma: 'DIPLOMA',
  'Associate Degree': 'DIPLOMA',
  Bachelor: 'BACHELOR',
  Master: 'MASTER',
  PhD: 'PHD',
};

// q17 GPA band → approx 0–4 GPA (compared against programme minGpa).
const GPA_TO_NUM: Record<string, number> = {
  'Excellent (top 10%)': 3.8,
  'Good (above average)': 3.2,
  Average: 2.5,
  'Weak (below average)': 1.8,
};

// q22 English band → IELTS-equivalent overall. 'No test taken' → undefined.
const ENGLISH_TO_IELTS: Record<string, number> = {
  'IELTS 7+ / equivalent': 7,
  'IELTS 6 - 6.5': 6,
  'IELTS 5 - 5.5': 5,
  'Below IELTS 5': 4,
};

export type ScorecardAnswers = Record<string, string>;

// Pure: decrypted /scorecard answers + a StudyField key→id lookup (+ optional
// nationality) → MatchCriteria. Deterministic; freeze-tested.
export function buildCriteriaFromScorecardAnswers(
  answers: ScorecardAnswers,
  studyFieldIdByKey: Record<string, string>,
  nationality?: string,
): MatchCriteria {
  const fieldKey = reverseMapQ16(answers.q16_field_main);
  const qualificationFieldId = fieldKey ? studyFieldIdByKey[fieldKey] ?? null : null;

  const q15 = answers.q15_highest_qual;
  const q17 = answers.q17_gpa;
  const q22 = answers.q22_english_score;
  const q43 = answers.q43_city;

  return {
    qualificationFieldId,
    preferredFieldIds: [],   // DELIBERATE — see header
    desiredLevels: [],       // DELIBERATE — no source
    currentHighestLevel: q15 ? HIGHEST_TO_LEVEL[q15] ?? null : null,
    gpaBand: q17 ? GPA_TO_NUM[q17] : undefined,
    ieltsEquivalent: q22 ? ENGLISH_TO_IELTS[q22] : undefined,
    tuitionBudgetNZD: undefined, // DELIBERATE — funds band ≠ tuition budget
    nationality: nationality || undefined,
    locationPref: q43 ? (q43 === 'Flexible' ? ['flexible'] : [q43]) : undefined,
    workWhileStudying: undefined, // no source
  };
}
