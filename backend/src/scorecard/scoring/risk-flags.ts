// PR-SCORECARD-1 — verbatim port of detect_risk_flags().
//
// Source: Sorena_Scoring_Reference/sorena_scoring.py lines 444-467.
// Risk flags are informational — they don't block execution but do
// signal areas for staff attention. The exact string labels are
// preserved because they appear in the SAMPLE_Scoring_Report.pdf
// and in audit rows.

export function detectRiskFlags(
  answers: Record<string, string>,
  catScores: Record<number, number>,
): string[] {
  const flags: string[] = [];

  const cat3 = catScores[3] ?? 0;
  if (cat3 >= 7 && cat3 <= 14) {
    flags.push('Financial Fragility');
  }
  if (
    answers.q22_english_score === 'IELTS 5 - 5.5'
    || answers.q22_english_score === 'Below IELTS 5'
  ) {
    flags.push('Weak English');
  }
  if (
    answers.q26_field_change === 'Yes'
    && answers.q30_work_relevance === 'Unrelated'
  ) {
    flags.push('Weak Academic Alignment');
  }
  if (
    answers.q18_years_since === '5 - 10 years'
    || answers.q18_years_since === '10+ years'
  ) {
    flags.push('Long Study Gap');
  }
  if (answers.q13_travel_history === 'No international travel') {
    flags.push('No Travel History');
  }
  if (
    answers.q08_children === '2'
    || answers.q08_children === '3 or more'
  ) {
    flags.push('Dependents Complexity');
  }
  if (
    answers.q44_refusal === 'Yes'
    && answers.q45_refusal_count === '1'
  ) {
    flags.push('Prior Visa Refusal (single)');
  }
  if (answers.q27_study_goal === 'Immigration / settlement pathway') {
    flags.push('Immigration-Primary Motivation (visa genuineness)');
  }
  if (
    answers.q31_occupation === 'Unemployed'
    || answers.q31_occupation === 'Student only / No work experience'
  ) {
    flags.push('Career Risk');
  }
  if (answers.q40_docs_ready === 'Not ready') {
    flags.push('Document Readiness Gap');
  }
  return flags;
}
