// PR-SCORECARD-2 — Question schema for the public scorecard form.
//
// IMPORTANT: option strings are VERBATIM from the scoring engine's
// SCORES table (backend/src/scorecard/scoring/scores.ts). Do not "fix"
// capitalisation or spacing — the engine matches answer values
// exactly (with a case-insensitive trimmed fallback). The exact
// strings also appear in audit logs and the eventual PDF.
//
// Conditional rendering rules (Fix 1 + Fix 3 expand on PR-SCORECARD-2):
//   * q05_military          — only if q04_gender === 'Male'
//   * q07_marriage_years    — only if q06_marital in ['Married','Divorced','Widowed']
//                             — Fix 2: uses getLabel() so the question text
//                                       adapts to the actual life event
//                                       (marriage / divorce / widowhood).
//   * q08_children          — Fix 1: only if q06_marital in ['Married','Divorced','Widowed']
//                             (Singles never asked — handled by
//                              submit-helpers.ts which fills "0" before submit)
//   * q09/q10/q11 (partner) — only if q06_marital === 'Married'
//                             (Divorced/Widowed: filled "Not applicable"
//                              before submit so the engine gets +2 each)
//   * q22_english_score     — Fix 3: only if q21_english_cert is a VALID cert
//                             (not 'No certificate' nor 'Expired certificate')
//   * q23_test_date         — Fix 3: same condition as Q22
//   * q45_refusal_count     — only if q44_refusal === 'Yes'
//   * q46_refusal_recency   — only if q44_refusal === 'Yes'
//
// Hidden answers are auto-filled with their canonical fallback values
// by `submit-helpers.ts#fillHiddenAnswers` BEFORE the POST so the
// scoring engine receives a complete answer set (matches the Maryam
// Karimi test case which passes "Not applicable" for skipped fields).

export type QuestionType = 'text' | 'email' | 'phone' | 'select' | 'longtext';

export interface QuestionDef {
  id: string;
  type: QuestionType;
  // Static label. If `getLabel` is provided, it takes precedence.
  label: string;
  options?: string[];
  required?: boolean;
  // Returns true when this question should be VISIBLE / required.
  // Hidden questions are dropped at autosave and replaced by canonical
  // fallbacks at submit (see submit-helpers.ts).
  visibleWhen?: (answers: Record<string, string>) => boolean;
  // Fix 2: optional dynamic label resolver — invoked with the current
  // answers map. If present, overrides `label`. Used by Q7 so the
  // question text adapts to "marriage" / "divorce" / "widowhood".
  getLabel?: (answers: Record<string, string>) => string;
  // Optional helper text shown beneath the label.
  helper?: string;
}

// ─── SECTION 0 — CONTACT DETAILS ─────────────────────────────────────

export const CONTACT_QUESTIONS: QuestionDef[] = [
  { id: 'full_name',        type: 'text',  label: 'Full name',                                  required: true },
  { id: 'email',            type: 'email', label: 'Email address',                              required: true },
  { id: 'phone',            type: 'phone', label: 'Phone (with country code, e.g. +98 …)',     required: true },
  { id: 'current_country',  type: 'text',  label: 'Current country of residence',               required: true },
];

// ─── SECTION 1 — PROFILE & MIGRATION STABILITY ───────────────────────

export const SECTION_1_QUESTIONS: QuestionDef[] = [
  {
    id: 'q01_motivation',
    type: 'select',
    label: 'How would you describe your motivation to study and migrate?',
    options: ['Very High', 'High', 'Medium', 'Low'],
    required: true,
  },
  {
    id: 'q02_migrate_before_family',
    type: 'select',
    label: 'Are you open to migrating before bringing family?',
    options: ['Yes', 'Maybe', 'No'],
    required: true,
  },
  {
    id: 'q03_age',
    type: 'select',
    label: 'What is your age range?',
    options: ['Under 18', '18 - 21', '22 - 29', '30 - 39', '40 - 49', '50+'],
    required: true,
  },
  {
    id: 'q04_gender',
    type: 'select',
    label: 'Gender',
    options: ['Male', 'Female', 'Prefer not to say'],
    required: true,
  },
  {
    id: 'q05_military',
    type: 'select',
    label: 'Military service status',
    options: ['Completed', 'Exempted', 'Not applicable', 'Not completed'],
    required: true,
    visibleWhen: (a) => a.q04_gender === 'Male',
  },
  {
    id: 'q06_marital',
    type: 'select',
    label: 'Marital status',
    options: ['Single', 'Married', 'Divorced', 'Widowed'],
    required: true,
  },
  {
    // Fix 2: dynamic label — wording adapts to Q6.
    // Fix 4 (refinement batch following 7a458fe): dropdown no longer
    // shows "Not applicable" because Q7 is now only rendered when
    // Q6 ∈ {Married, Divorced, Widowed}. Singles never see Q7. The
    // submit-helpers.ts fallback STILL injects "Not applicable" for
    // Singles before POST, and the backend SCORES table still maps
    // that value to +2 pts — keeps the engine's invariant intact.
    id: 'q07_marriage_years',
    type: 'select',
    label: 'How many years has it been since your marriage / divorce / widowhood?',
    getLabel: (a) => {
      switch (a.q06_marital) {
        case 'Married':  return 'How many years have you been married?';
        case 'Divorced': return 'How many years has it been since your divorce?';
        case 'Widowed':  return 'How many years has it been since your spouse passed away?';
        default:         return 'Years since marriage / divorce / widowhood';
      }
    },
    options: ['Less than 1 year', '1 - 3 years', '3+ years'],
    required: true,
    visibleWhen: (a) => ['Married', 'Divorced', 'Widowed'].includes(a.q06_marital),
  },
  {
    // Fix 1: only asked when there's a partnership context. Singles
    // are auto-filled "0" by submit-helpers (matches Maryam's +3 pts).
    id: 'q08_children',
    type: 'select',
    label: 'Number of children',
    options: ['0', '1', '2', '3 or more'],
    required: true,
    visibleWhen: (a) => ['Married', 'Divorced', 'Widowed'].includes(a.q06_marital),
  },
  {
    id: 'q09_partner_age',
    type: 'select',
    label: 'Partner age range',
    options: ['Under 35', '35 - 45', '46+', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married',
  },
  {
    id: 'q10_partner_edu',
    type: 'select',
    label: 'Partner highest qualification',
    options: ['Bachelor or higher', 'Diploma', 'High School', 'No qualification', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married',
  },
  {
    id: 'q11_partner_english',
    type: 'select',
    label: 'Partner English level',
    options: ['IELTS / PTE equivalent', 'Basic English', 'No English', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married',
  },
  {
    id: 'q12_other_citizenship',
    type: 'select',
    label: 'Do you hold or are you eligible for another citizenship?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q13_travel_history',
    type: 'select',
    label: 'How would you describe your international travel history?',
    options: ['Multiple visa-requiring countries', 'Limited travel', 'Regional travel only', 'No international travel'],
    required: true,
  },
  {
    id: 'q14_visa_countries_type',
    type: 'select',
    label: 'Have you held visas for any of the following?',
    options: [
      'Yes - Tier-1 countries (NZ / AU / UK / US / CA / Schengen)',
      'Yes - regional travel only',
      'No',
    ],
    required: true,
  },
];

// ─── SECTION 2 — ACADEMIC & CAREER FOUNDATION ────────────────────────

export const SECTION_2_QUESTIONS: QuestionDef[] = [
  {
    id: 'q15_highest_qual',
    type: 'select',
    label: 'Highest qualification',
    options: ['High School', 'Diploma', 'Associate Degree', 'Bachelor', 'Master', 'PhD'],
    required: true,
  },
  {
    id: 'q16_field_main',
    type: 'select',
    label: 'Field of your highest qualification',
    options: [
      'Information Technology & Computer Science',
      'Healthcare & Medical',
      'Engineering',
      'Construction, Trades & Infrastructure',
      'Education & Teaching',
      'Agriculture & Primary Industries',
      'Business & Management',
      'Hospitality, Tourism & Culinary',
      'Science & Environment',
      'Aviation, Maritime & Transport',
      'Media & Communication',
      'Arts, Design & Creative Industries',
      'Law, Politics & Government',
      'Military & Security',
      'Religious & Theological Studies',
      'General / Interdisciplinary',
      'Other',
    ],
    required: true,
  },
  {
    id: 'q17_gpa',
    type: 'select',
    label: 'Academic GPA / grade band',
    options: ['Excellent (top 10%)', 'Good (above average)', 'Average', 'Weak (below average)'],
    required: true,
  },
  {
    id: 'q18_years_since',
    type: 'select',
    label: 'Years since you finished your highest qualification',
    options: ['Less than 2 years', '2 - 5 years', '5 - 10 years', '10+ years'],
    required: true,
  },
  {
    id: 'q19_docs_translated',
    type: 'select',
    label: 'Are your academic documents translated and certified?',
    options: ['Yes - fully translated', 'Partially', 'No'],
    required: true,
  },
  {
    id: 'q20_publications',
    type: 'select',
    label: 'Do you have any academic publications, patents, or research output?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q21_english_cert',
    type: 'select',
    label: 'English certificate type',
    options: ['IELTS Academic', 'IELTS General', 'PTE', 'TOEFL', 'Duolingo', 'NZCEL', 'Expired certificate', 'No certificate'],
    required: true,
  },
  {
    // Fix 3: hidden when no certificate or expired (asking for the
    // score of an expired cert is misleading). Auto-filled
    // "No test taken" by submit-helpers (0 pts — matches engine).
    id: 'q22_english_score',
    type: 'select',
    label: 'English score (approximate IELTS-equivalent)',
    options: ['IELTS 7+ / equivalent', 'IELTS 6 - 6.5', 'IELTS 5 - 5.5', 'Below IELTS 5', 'No test taken'],
    required: true,
    visibleWhen: (a) =>
      !!a.q21_english_cert
      && a.q21_english_cert !== 'No certificate'
      && a.q21_english_cert !== 'Expired certificate',
  },
  {
    // Fix 3: same condition as Q22.
    id: 'q23_test_date',
    type: 'select',
    label: 'When did you take your English test?',
    options: ['Less than 1 year ago', '1 - 2 years ago', 'Expired (more than 2 years)', 'No test taken'],
    required: true,
    visibleWhen: (a) =>
      !!a.q21_english_cert
      && a.q21_english_cert !== 'No certificate'
      && a.q21_english_cert !== 'Expired certificate',
  },
  {
    id: 'q24_studied_english',
    type: 'select',
    label: 'Have you previously studied in English?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q25_intended_study',
    type: 'select',
    label: 'Intended study field',
    options: [
      'Information Technology / AI / Data',
      'Business & Management',
      'Healthcare & Nursing',
      'Engineering',
      'Trades & Construction',
      'Hospitality & Culinary',
      'Creative Arts & Design',
      'Education & Teaching',
      'Science & Environment',
      'Other',
    ],
    required: true,
  },
  {
    id: 'q26_field_change',
    type: 'select',
    label: 'Are you changing fields (different from your previous qualification)?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q27_study_goal',
    type: 'select',
    label: 'Primary goal for studying abroad',
    options: [
      'Career progression in my current field',
      'Career change to a new field',
      'Immigration / settlement pathway',
      'International qualification',
      'Research',
      'English language only',
    ],
    required: true,
  },
  {
    id: 'q28_work_after_grad',
    type: 'select',
    label: 'Do you plan to work in NZ after graduation?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q29_years_work',
    type: 'select',
    label: 'Total years of work experience',
    options: ['None', '1 - 2 years', '3 - 5 years', '5 - 10 years', '10+ years'],
    required: true,
  },
  {
    id: 'q30_work_relevance',
    type: 'select',
    label: 'How related is your work experience to your intended study?',
    options: ['Fully related', 'Partially related', 'Unrelated'],
    required: true,
  },
  {
    id: 'q31_occupation',
    type: 'select',
    label: 'Current occupation category',
    options: [
      'Healthcare & Aged Care',
      'Construction & Infrastructure',
      'Engineering & Trades',
      'Information Technology & Software',
      'Education & Teaching',
      'Agriculture & Primary Industries',
      'Hospitality & Tourism',
      'Retail & Customer Service',
      'Administration & Office Work',
      'Sales & Marketing',
      'Business, Finance & Accounting',
      'Manufacturing & Logistics',
      'Self-Employed / Small Business Owner',
      'Other General Employment',
      'Unemployed',
      'Student only / No work experience',
    ],
    required: true,
  },
  {
    id: 'q32_employment_type',
    type: 'select',
    label: 'Current employment type',
    options: ['Full-time', 'Part-time', 'Self-employed', 'Business owner', 'Unemployed'],
    required: true,
  },
];

// ─── SECTION 3 — FINANCIAL & OPERATIONAL READINESS ───────────────────

export const SECTION_3_QUESTIONS: QuestionDef[] = [
  {
    id: 'q33_funds',
    type: 'select',
    label: 'Funds available for study and settlement',
    options: [
      'NZD 60,000+',
      'NZD 40,000 - 60,000',
      'NZD 20,000 - 40,000',
      'NZD 10,000 - 20,000',
      'Less than NZD 10,000',
    ],
    required: true,
  },
  {
    id: 'q34_funds_source',
    type: 'select',
    label: 'Primary source of funds',
    options: ['Personal savings', 'Business income', 'Family support', 'Sponsor support', 'Mixed sources'],
    required: true,
  },
  {
    id: 'q35_overseas_bank',
    type: 'select',
    label: 'Do you have an overseas (non-Iranian) bank account?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q36_financial_docs',
    type: 'select',
    label: 'Are your financial documents ready (statements, translations)?',
    options: ['Yes - fully', 'Partially', 'No'],
    required: true,
  },
  {
    id: 'q37_overseas_contacts',
    type: 'select',
    label: 'Do you have family or close contacts overseas?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q38_settlement_support',
    type: 'select',
    label: 'Will you have settlement support on arrival?',
    options: ['Yes', 'Maybe', 'No'],
    required: true,
  },
  {
    id: 'q39_passport',
    type: 'select',
    label: 'Do you have a valid passport?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q40_docs_ready',
    type: 'select',
    label: 'Are all your application documents ready?',
    options: ['Fully ready', 'Partially ready', 'Not ready'],
    required: true,
  },
  {
    id: 'q41_apply_timeline',
    type: 'select',
    label: 'When do you want to apply?',
    options: ['Immediately', 'Within 1 month', 'Within 3 months', '6+ months'],
    required: true,
  },
  {
    id: 'q42_intake',
    type: 'select',
    label: 'Preferred intake',
    options: ['ASAP', 'Next intake', '6 months later', 'Flexible'],
    required: true,
  },
  {
    id: 'q43_city',
    type: 'select',
    label: 'Preferred city in New Zealand',
    options: ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Dunedin', 'Flexible'],
    required: true,
  },
];

// ─── SECTION 4 — IMMIGRATION & RISK ASSESSMENT ───────────────────────

export const SECTION_4_QUESTIONS: QuestionDef[] = [
  {
    id: 'q44_refusal',
    type: 'select',
    label: 'Have you ever been refused a visa to any country?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q45_refusal_count',
    type: 'select',
    label: 'How many visa refusals?',
    options: ['1', '2', '3 or more', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q44_refusal === 'Yes',
  },
  {
    id: 'q46_refusal_recency',
    type: 'select',
    label: 'When was the most recent refusal?',
    options: ['Less than 6 months ago', '6 - 12 months ago', '1 - 2 years ago', 'More than 2 years ago', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q44_refusal === 'Yes',
  },
  {
    id: 'q47_medical',
    type: 'select',
    label: 'Any major medical conditions?',
    options: ['No major issues', 'Minor / manageable conditions', 'Serious / unresolved'],
    required: true,
  },
  {
    id: 'q48_police_clearance',
    type: 'select',
    label: 'Can you obtain a police clearance certificate?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q49_breach',
    type: 'select',
    label: 'Have you ever overstayed or breached a visa condition?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q50_other_identity',
    type: 'select',
    label: 'Have you ever used a different name or identity?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q51_self_submitted',
    type: 'select',
    label: 'Have you submitted any immigration application yourself before?',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q52_other_agent',
    type: 'select',
    label: 'Are you currently working with another agent on this application?',
    options: ['Yes', 'No'],
    required: true,
  },
];

// ─── FORM SCHEMA ─────────────────────────────────────────────────────

export const FORM_SCHEMA: Array<{ sectionId: number; questions: QuestionDef[] }> = [
  { sectionId: 0, questions: CONTACT_QUESTIONS },
  { sectionId: 1, questions: SECTION_1_QUESTIONS },
  { sectionId: 2, questions: SECTION_2_QUESTIONS },
  { sectionId: 3, questions: SECTION_3_QUESTIONS },
  { sectionId: 4, questions: SECTION_4_QUESTIONS },
];

// All questions in flat order (for autosave merge, etc.)
export const ALL_QUESTIONS: QuestionDef[] = FORM_SCHEMA.flatMap((s) => s.questions);

// Helper: is a question visible given current answers?
export function isQuestionVisible(q: QuestionDef, answers: Record<string, string>): boolean {
  if (!q.visibleWhen) return true;
  return q.visibleWhen(answers);
}

// Fix 2: resolves the active label for a question (`getLabel` takes
// precedence over the static label).
export function getQuestionLabel(q: QuestionDef, answers: Record<string, string>): string {
  return q.getLabel ? q.getLabel(answers) : q.label;
}
