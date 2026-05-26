// PR-SCORECARD-1 — verbatim port of sorena_scoring.py SCORES dict +
// FIELD_CATEGORIES + CATEGORY_NAMES + CATEGORY_MAX.
//
// Source: Sorena_Scoring_Reference/sorena_scoring.py lines 18-359.
// Every key string (including capitalisation, spacing, em-dashes, and
// punctuation) is identical to the Python source. Do NOT "fix"
// what looks like inconsistent capitalisation — those exact strings
// are also what land in audit logs and the SAMPLE_Scoring_Report.pdf.

export type ScoresTable = Record<string, Record<string, number>>;

export const SCORES: ScoresTable = {

  // ─── CATEGORY 1: PROFILE & MIGRATION STABILITY (20 pts) ──────────────

  q01_motivation: {
    'Very High': 4, 'High': 3, 'Medium': 2, 'Low': 0,
  },
  q02_migrate_before_family: {
    'Yes': 3, 'Maybe': 1, 'No': 0,
  },
  q03_age: {
    'Under 18': 1,
    '18 - 21': 3,
    '22 - 29': 4,
    '30 - 39': 3,
    '40 - 49': 2,
    '50+': 1,
  },
  // Q4 not scored
  q04_gender: {
    'Male': 0, 'Female': 0, 'Prefer not to say': 0,
  },
  q05_military: {
    'Completed': 3, 'Exempted': 2, 'Not applicable': 2,
    'Not completed': 0,
  },
  q06_marital: {
    'Single': 3, 'Married': 2, 'Divorced': 1, 'Widowed': 1,
  },
  q07_marriage_years: {
    'Less than 1 year': 0,
    '1 - 3 years': 1,
    '3+ years': 2,
    'Not applicable': 2,
  },
  q08_children: {
    '0': 3, '1': 2, '2': 1, '3 or more': 0,
  },
  q09_partner_age: {
    'Under 35': 2, '35 - 45': 1, '46+': 0, 'Not applicable': 2,
  },
  q10_partner_edu: {
    'Bachelor or higher': 3, 'Diploma': 2, 'High School': 1,
    'No qualification': 0, 'Not applicable': 2,
  },
  q11_partner_english: {
    'IELTS / PTE equivalent': 3, 'Basic English': 1, 'No English': 0,
    'Not applicable': 2,
  },
  q12_other_citizenship: {
    'Yes': 3, 'No': 1,
  },
  q13_travel_history: {
    'Multiple visa-requiring countries': 3,
    'Limited travel': 1,
    'Regional travel only': 1,
    'No international travel': 0,
  },
  q14_visa_countries_type: {
    'Yes - Tier-1 countries (NZ / AU / UK / US / CA / Schengen)': 3,
    'Yes - regional travel only': 1,
    'No': 0,
  },

  // ─── CATEGORY 2: ACADEMIC & CAREER FOUNDATION (35 pts) ───────────────

  q15_highest_qual: {
    'High School': 3, 'Diploma': 5, 'Associate Degree': 5,
    'Bachelor': 7, 'Master': 8, 'PhD': 8,
  },
  q16_field_main: {
    'Information Technology & Computer Science': 4,
    'Healthcare & Medical': 4,
    'Engineering': 4,
    'Construction, Trades & Infrastructure': 4,
    'Education & Teaching': 4,
    'Agriculture & Primary Industries': 4,
    'Business & Management': 3,
    'Hospitality, Tourism & Culinary': 3,
    'Science & Environment': 3,
    'Aviation, Maritime & Transport': 3,
    'Media & Communication': 2,
    'Arts, Design & Creative Industries': 2,
    'Law, Politics & Government': 2,
    'Military & Security': 2,
    'Religious & Theological Studies': 1,
    'General / Interdisciplinary': 1,
    'Other': 0,
  },
  q17_gpa: {
    'Excellent (top 10%)': 6,
    'Good (above average)': 5,
    'Average': 3,
    'Weak (below average)': 1,
  },
  q18_years_since: {
    'Less than 2 years': 4, '2 - 5 years': 3,
    '5 - 10 years': 1, '10+ years': 0,
  },
  q19_docs_translated: {
    'Yes - fully translated': 4, 'Partially': 2, 'No': 0,
  },
  q20_publications: {
    'Yes': 2, 'No': 0,
  },
  q21_english_cert: {
    'IELTS Academic': 5, 'IELTS General': 4, 'PTE': 5, 'TOEFL': 5,
    'Duolingo': 3, 'NZCEL': 5,
    'Expired certificate': 2, 'No certificate': 0,
  },
  q22_english_score: {
    'IELTS 7+ / equivalent': 7,
    'IELTS 6 - 6.5': 5,
    'IELTS 5 - 5.5': 3,
    'Below IELTS 5': 1,
    'No test taken': 0,
  },
  // Q23 not scored
  q23_test_date: {
    'Less than 1 year ago': 0, '1 - 2 years ago': 0,
    'Expired (more than 2 years)': 0, 'No test taken': 0,
  },
  q24_studied_english: {
    'Yes': 1, 'No': 0,
  },
  // Q25 not scored — building the inner zero-map by hand mirrors the
  // Python `{k: 0 for k in [...]}` comprehension.
  q25_intended_study: {
    'Information Technology / AI / Data': 0,
    'Business & Management': 0,
    'Healthcare & Nursing': 0,
    'Engineering': 0,
    'Trades & Construction': 0,
    'Hospitality & Culinary': 0,
    'Creative Arts & Design': 0,
    'Education & Teaching': 0,
    'Science & Environment': 0,
    'Other': 0,
  },
  q26_field_change: {
    'Yes': 0, 'No': 1,
  },
  q27_study_goal: {
    'Career progression in my current field': 4,
    'Career change to a new field': 2,
    'Immigration / settlement pathway': 1,
    'International qualification': 3,
    'Research': 4,
    'English language only': 2,
  },
  q28_work_after_grad: {
    'Yes': 1, 'No': 0,
  },
  q29_years_work: {
    'None': 0, '1 - 2 years': 2, '3 - 5 years': 4,
    '5 - 10 years': 5, '10+ years': 5,
  },
  q30_work_relevance: {
    'Fully related': 3, 'Partially related': 2, 'Unrelated': 0,
  },
  q31_occupation: {
    'Healthcare & Aged Care': 4,
    'Construction & Infrastructure': 4,
    'Engineering & Trades': 4,
    'Information Technology & Software': 4,
    'Education & Teaching': 4,
    'Agriculture & Primary Industries': 4,
    'Hospitality & Tourism': 2,
    'Retail & Customer Service': 2,
    'Administration & Office Work': 2,
    'Sales & Marketing': 2,
    'Business, Finance & Accounting': 2,
    'Manufacturing & Logistics': 2,
    'Self-Employed / Small Business Owner': 2,
    'Other General Employment': 2,
    'Unemployed': 0,
    'Student only / No work experience': 0,
  },
  // Q32 not scored
  q32_employment_type: {
    'Full-time': 0, 'Part-time': 0, 'Self-employed': 0,
    'Business owner': 0, 'Unemployed': 0,
  },

  // ─── CATEGORY 3: FINANCIAL & OPERATIONAL READINESS (25 pts) ──────────

  q33_funds: {
    'NZD 60,000+': 8,
    'NZD 40,000 - 60,000': 6,
    'NZD 20,000 - 40,000': 4,
    'NZD 10,000 - 20,000': 1,
    'Less than NZD 10,000': 0,
  },
  q34_funds_source: {
    'Personal savings': 5,
    'Business income': 5,
    'Family support': 3,
    'Sponsor support': 3,
    'Mixed sources': 2,
  },
  q35_overseas_bank: {
    'Yes': 4, 'No': 1,
  },
  q36_financial_docs: {
    'Yes - fully': 4, 'Partially': 2, 'No': 0,
  },
  q37_overseas_contacts: {
    'Yes': 1, 'No': 0,
  },
  q38_settlement_support: {
    'Yes': 1, 'Maybe': 0, 'No': 0,
  },
  q39_passport: {
    'Yes': 3, 'No': 0,
  },
  q40_docs_ready: {
    'Fully ready': 4, 'Partially ready': 2, 'Not ready': 0,
  },
  q41_apply_timeline: {
    'Immediately': 4, 'Within 1 month': 3,
    'Within 3 months': 2, '6+ months': 0,
  },
  // Q42 not scored
  q42_intake: {
    'ASAP': 0, 'Next intake': 0, '6 months later': 0, 'Flexible': 0,
  },
  // Q43 not scored
  q43_city: {
    'Auckland': 0, 'Wellington': 0, 'Christchurch': 0,
    'Hamilton': 0, 'Dunedin': 0, 'Flexible': 0,
  },

  // ─── CATEGORY 4: IMMIGRATION & RISK ASSESSMENT (20 pts) ──────────────

  q44_refusal: {
    'Yes': 0, 'No': 6,
  },
  q45_refusal_count: {
    '1': 1, '2': 0, '3 or more': 0, 'Not applicable': 0,
  },
  q46_refusal_recency: {
    'Less than 6 months ago': 0,
    '6 - 12 months ago': 0,
    '1 - 2 years ago': 1,
    'More than 2 years ago': 3,
    'Not applicable': 0,
  },
  q47_medical: {
    'No major issues': 4,
    'Minor / manageable conditions': 2,
    'Serious / unresolved': 0,
  },
  q48_police_clearance: {
    'Yes': 4, 'No': 0,
  },
  q49_breach: {
    'Yes': 0, 'No': 3,
  },
  q50_other_identity: {
    'Yes': 0, 'No': 2,
  },
  q51_self_submitted: {
    'Yes': 1, 'No': 2,
  },
  q52_other_agent: {
    'Yes': 1, 'No': 2,
  },
};

export const FIELD_CATEGORIES: Record<string, 1 | 2 | 3 | 4> = {
  // Cat 1 (20 pts max)
  q01_motivation: 1, q02_migrate_before_family: 1, q03_age: 1,
  q05_military: 1, q06_marital: 1, q07_marriage_years: 1,
  q08_children: 1, q09_partner_age: 1, q10_partner_edu: 1,
  q11_partner_english: 1, q12_other_citizenship: 1,
  q13_travel_history: 1, q14_visa_countries_type: 1,

  // Cat 2 (35 pts max)
  q15_highest_qual: 2, q16_field_main: 2, q17_gpa: 2,
  q18_years_since: 2, q19_docs_translated: 2, q20_publications: 2,
  q21_english_cert: 2, q22_english_score: 2, q24_studied_english: 2,
  q26_field_change: 2, q27_study_goal: 2, q28_work_after_grad: 2,
  q29_years_work: 2, q30_work_relevance: 2, q31_occupation: 2,

  // Cat 3 (25 pts max)
  q33_funds: 3, q34_funds_source: 3, q35_overseas_bank: 3,
  q36_financial_docs: 3, q37_overseas_contacts: 3,
  q38_settlement_support: 3, q39_passport: 3, q40_docs_ready: 3,
  q41_apply_timeline: 3,

  // Cat 4 (20 pts max)
  q44_refusal: 4, q45_refusal_count: 4, q46_refusal_recency: 4,
  q47_medical: 4, q48_police_clearance: 4, q49_breach: 4,
  q50_other_identity: 4, q51_self_submitted: 4, q52_other_agent: 4,
};

export const CATEGORY_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Profile & Migration Stability',
  2: 'Academic & Career Foundation',
  3: 'Financial & Operational Readiness',
  4: 'Immigration & Risk Assessment',
};

export const CATEGORY_MAX: Record<1 | 2 | 3 | 4, number> = {
  1: 20, 2: 35, 3: 25, 4: 20,
};
