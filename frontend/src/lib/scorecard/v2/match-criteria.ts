// PR-PHASE33 — derive the Matching Engine input (MatchCriteria) from the v2
// assessment form state. Mirrors the backend MatchCriteria shape; posted to the
// public matching endpoint on submission.
import type { V2State } from './scoring-answers';

export interface MatchCriteria {
  qualificationFieldId: string | null; // Q13 StudyField id
  preferredFieldIds: string[];         // Q32
  desiredLevels: string[];             // Q33 (QualificationLevel[])
  currentHighestLevel: string | null;  // Q12 (q15) mapped to the canonical ladder
  gpaBand?: number;                    // Q14 (q17)
  ieltsEquivalent?: number;            // Q16 (q22)
  tuitionBudgetNZD?: number;           // Q34
  nationality?: string;                // Q5 (contact)
  locationPref?: string[];             // Q35 (q43)
  workWhileStudying?: boolean;         // Q36
}

// q15 "Highest qualification" → canonical QualificationLevel ladder.
const HIGHEST_TO_LEVEL: Record<string, string | null> = {
  'High School': null,          // below the programme ladder
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

// q22 English score band → IELTS-equivalent overall.
const ENGLISH_TO_IELTS: Record<string, number> = {
  'IELTS 7+ / equivalent': 7,
  'IELTS 6 - 6.5': 6,
  'IELTS 5 - 5.5': 5,
  'Below IELTS 5': 4,
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function buildMatchCriteria(state: V2State): MatchCriteria {
  const q15 = str(state.q15_highest_qual);
  const q17 = str(state.q17_gpa);
  const q22 = str(state.q22_english_score);
  const q43 = str(state.q43_city);
  const desired = state.q33_desired_level;

  return {
    qualificationFieldId: str(state.q13_qualification_field) ?? null,
    preferredFieldIds: Array.isArray(state.q32_preferred_fields) ? (state.q32_preferred_fields as string[]) : [],
    desiredLevels: Array.isArray(desired) ? (desired as string[]) : desired ? [String(desired)] : [],
    currentHighestLevel: q15 ? HIGHEST_TO_LEVEL[q15] ?? null : null,
    gpaBand: q17 ? GPA_TO_NUM[q17] : undefined,
    ieltsEquivalent: q22 ? ENGLISH_TO_IELTS[q22] : undefined,
    tuitionBudgetNZD: typeof state.q34_tuition_budget === 'number' ? state.q34_tuition_budget
      : str(state.q34_tuition_budget) ? Number(state.q34_tuition_budget) : undefined,
    nationality: str(state.nationality),
    locationPref: q43 ? (q43 === 'Flexible' ? ['flexible'] : [q43]) : undefined,
    workWhileStudying: typeof state.q36_work_while_studying === 'boolean' ? state.q36_work_while_studying : undefined,
  };
}
