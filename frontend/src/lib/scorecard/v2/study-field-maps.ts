// PR-PHASE33 — StudyField ↔ scoring-answer maps.
//
// The redesigned assessment captures the applicant's field of qualification (Q13)
// and preferred fields (Q32) via the StudyField taxonomy. For byte-identical
// scoring, those selections must still produce the exact q16 / q25 answer STRINGS
// the current engine scores. Each StudyField key maps to:
//   * q16 option — SAME weight as the field's backgroundWeight (verified by the
//     seed), so cat-2 scoring is unchanged.
//   * q25 option — only the 'Other' vs non-'Other' distinction affects scoring
//     (HS2: High School + intended-study 'Other'); mapped to real values for the
//     answer log.
// Keys match scripts/seed-study-fields.ts. Strings are verbatim from
// backend SCORES / questions.ts — do NOT edit casing/spacing.

export const STUDYFIELD_TO_Q16: Record<string, string> = {
  it_computer_science: 'Information Technology & Computer Science', // 4
  healthcare_medical: 'Healthcare & Medical', // 4
  nursing: 'Healthcare & Medical', // 4
  engineering: 'Engineering', // 4
  construction_trades: 'Construction, Trades & Infrastructure', // 4
  education_teaching: 'Education & Teaching', // 4
  agriculture: 'Agriculture & Primary Industries', // 4
  business_management: 'Business & Management', // 3
  project_management: 'Business & Management', // 3
  healthcare_management: 'Business & Management', // 3
  hospitality_management: 'Hospitality, Tourism & Culinary', // 3
  science_environment: 'Science & Environment', // 3
  aviation_transport: 'Aviation, Maritime & Transport', // 3
  hospitality_culinary: 'Hospitality, Tourism & Culinary', // 3
  media_communication: 'Media & Communication', // 2
  arts_design: 'Arts, Design & Creative Industries', // 2
  law_government: 'Law, Politics & Government', // 2
  general_interdisciplinary: 'General / Interdisciplinary', // 1
  other: 'Other', // 0
  // PR-PHASE34 — new fields have no scored q16 option → 'Other' (0), preserving
  // byte-identical scoring for a qualification in one of these areas.
  personal_services: 'Other', // 0
  sport_recreation: 'Other', // 0
  social_community: 'Other', // 0
  foundation_pathways: 'Other', // 0
};

export const STUDYFIELD_TO_Q25: Record<string, string> = {
  it_computer_science: 'Information Technology / AI / Data',
  healthcare_medical: 'Healthcare & Nursing',
  nursing: 'Healthcare & Nursing',
  healthcare_management: 'Healthcare & Nursing',
  engineering: 'Engineering',
  construction_trades: 'Trades & Construction',
  education_teaching: 'Education & Teaching',
  agriculture: 'Science & Environment',
  science_environment: 'Science & Environment',
  business_management: 'Business & Management',
  project_management: 'Business & Management',
  hospitality_management: 'Hospitality & Culinary',
  hospitality_culinary: 'Hospitality & Culinary',
  media_communication: 'Creative Arts & Design',
  arts_design: 'Creative Arts & Design',
  aviation_transport: 'Other',
  law_government: 'Other',
  general_interdisciplinary: 'Other',
  other: 'Other',
  personal_services: 'Other',
  sport_recreation: 'Other',
  social_community: 'Other',
  foundation_pathways: 'Other',
};
