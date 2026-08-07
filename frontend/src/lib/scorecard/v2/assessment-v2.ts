// PR-PHASE33 — the redesigned (v2) assessment layout: 7 sections, ~37 questions,
// presented as 8 steps (7 content + a declaration).
//
// Each SCORED sub-field reuses its existing qNN key + option strings verbatim
// (pulled from questions.ts) so scoring is byte-identical (proven by
// scripts/verify-v2-scoring.cjs). Compound questions group several sub-fields
// under one heading. Section 7 (Study Preferences) + nationality add non-scored
// matching inputs;
// Q13/Q32 use the StudyField taxonomy.

import { ALL_QUESTIONS } from '../questions';

const opts = (id: string): string[] => ALL_QUESTIONS.find((q) => q.id === id)?.options ?? [];

export type FieldType = 'select' | 'text' | 'email' | 'phone' | 'country' | 'number'
  | 'studyfield' | 'studyfield-multi' | 'boolean';

export interface V2FieldDef {
  key: string;               // qNN (scored) or a new preference/contact key
  type: FieldType;
  label: string;
  options?: string[];
  required?: boolean;
  helper?: string;
  visibleWhen?: (a: Record<string, unknown>) => boolean;
}

export interface V2QuestionDef {
  id: string;
  heading: string;
  fields: V2FieldDef[];
  visibleWhen?: (a: Record<string, unknown>) => boolean;
}

export interface V2SectionDef {
  id: number;
  title: string;
  questions: V2QuestionDef[];
}

const isMarried = (a: Record<string, unknown>) => a.q06_marital === 'Married';
const isPartnered = (a: Record<string, unknown>) => ['Married', 'Divorced', 'Widowed'].includes(String(a.q06_marital));
const validCert = (a: Record<string, unknown>) => !!a.q21_english_cert
  && a.q21_english_cert !== 'No certificate' && a.q21_english_cert !== 'Expired certificate';
const refused = (a: Record<string, unknown>) => a.q44_refusal === 'Yes';
const isBachelorPlus = (a: Record<string, unknown>) => ['Bachelor', 'Master', 'PhD'].includes(String(a.q15_highest_qual));

export const ASSESSMENT_V2: V2SectionDef[] = [
  {
    id: 1, title: 'Contact & Identity',
    questions: [
      { id: 'name', heading: 'Full name', fields: [{ key: 'full_name', type: 'text', label: 'Full name', required: true }] },
      { id: 'email', heading: 'Email address', fields: [{ key: 'email', type: 'email', label: 'Email address', required: true }] },
      { id: 'phone', heading: 'Phone number', fields: [{ key: 'phone', type: 'phone', label: 'Phone (with country code)', required: true }] },
      { id: 'residence', heading: 'Country of residence', fields: [{ key: 'current_country', type: 'country', label: 'Country of residence', required: true }] },
      { id: 'nationality', heading: 'Nationality', fields: [{ key: 'nationality', type: 'country', label: 'Nationality', required: true, helper: 'Used to surface scholarships you may be eligible for.' }] },
    ],
  },
  {
    id: 2, title: 'About You',
    questions: [
      { id: 'motivation', heading: 'Motivation', fields: [{ key: 'q01_motivation', type: 'select', label: 'How would you describe your motivation to study and migrate abroad?', options: opts('q01_motivation'), required: true }] },
      { id: 'migrate-family', heading: 'Family plans', fields: [{ key: 'q02_migrate_before_family', type: 'select', label: 'Are you open to migrating before bringing family?', options: opts('q02_migrate_before_family'), required: true }] },
      { id: 'age', heading: 'Age', fields: [{ key: 'q03_age', type: 'select', label: 'What is your age range?', options: opts('q03_age'), required: true }] },
      { id: 'military', heading: 'Military service', fields: [{ key: 'q05_military', type: 'select', label: 'Military service status', options: opts('q05_military'), required: true, helper: 'Choose "Not applicable" if this does not apply to you.' }] },
      {
        id: 'family', heading: 'Marital status & dependents',
        fields: [
          { key: 'q06_marital', type: 'select', label: 'Marital status', options: opts('q06_marital'), required: true },
          { key: 'q08_children', type: 'select', label: 'Number of children', options: opts('q08_children'), required: true, visibleWhen: isPartnered },
          { key: 'q07_marriage_years', type: 'select', label: 'Years since marriage / divorce / widowhood', options: opts('q07_marriage_years'), required: true, visibleWhen: isPartnered },
          { key: 'q10_partner_edu', type: 'select', label: "Partner's highest qualification", options: opts('q10_partner_edu'), required: true, visibleWhen: isMarried },
          { key: 'q11_partner_english', type: 'select', label: "Partner's English level", options: opts('q11_partner_english'), required: true, visibleWhen: isMarried },
          { key: 'q09_partner_age', type: 'select', label: 'Partner age range', options: opts('q09_partner_age'), required: true, visibleWhen: isMarried },
        ],
      },
      {
        id: 'travel', heading: 'International travel, visas & citizenship',
        fields: [
          { key: 'q13_travel_history', type: 'select', label: 'How would you describe your international travel history?', options: opts('q13_travel_history'), required: true },
          { key: 'q14_visa_countries_type', type: 'select', label: 'Have you held visas for any of the following?', options: opts('q14_visa_countries_type'), required: true },
          { key: 'q12_other_citizenship', type: 'select', label: 'Do you hold or qualify for another citizenship?', options: opts('q12_other_citizenship'), required: true },
        ],
      },
    ],
  },
  {
    id: 3, title: 'Education & English',
    questions: [
      { id: 'qual', heading: 'Highest qualification', fields: [{ key: 'q15_highest_qual', type: 'select', label: 'Highest qualification completed', options: opts('q15_highest_qual'), required: true }] },
      { id: 'qual-field', heading: 'Field of your qualification', fields: [{ key: 'q13_qualification_field', type: 'studyfield', label: 'Field of your highest qualification', required: true, helper: 'This determines which fields you can choose from in Study Preferences.' }] },
      {
        id: 'gpa', heading: 'Academic record',
        fields: [
          { key: 'q17_gpa', type: 'select', label: 'Academic GPA / grade band', options: opts('q17_gpa'), required: true },
          { key: 'q19_docs_translated', type: 'select', label: 'Are your academic documents translated and certified?', options: opts('q19_docs_translated'), required: true },
          { key: 'q20_publications', type: 'select', label: 'Any academic publications, patents, or research output?', options: opts('q20_publications'), required: true, visibleWhen: isBachelorPlus },
        ],
      },
      { id: 'years-since', heading: 'Recency', fields: [{ key: 'q18_years_since', type: 'select', label: 'Years since you completed your highest qualification', options: opts('q18_years_since'), required: true }] },
      {
        id: 'english', heading: 'English proficiency',
        fields: [
          { key: 'q21_english_cert', type: 'select', label: 'English certificate type', options: opts('q21_english_cert'), required: true },
          { key: 'q22_english_score', type: 'select', label: 'English score (approximate IELTS-equivalent)', options: opts('q22_english_score'), required: true, visibleWhen: validCert },
          { key: 'q23_test_date', type: 'select', label: 'When did you take your English test?', options: opts('q23_test_date'), required: true, visibleWhen: validCert },
          { key: 'q24_studied_english', type: 'select', label: 'Have you previously studied in English?', options: opts('q24_studied_english'), required: true },
        ],
      },
    ],
  },
  {
    id: 4, title: 'Study Goals & Career',
    questions: [
      { id: 'goal', heading: 'Study goal', fields: [{ key: 'q27_study_goal', type: 'select', label: 'Your main goal for studying abroad', options: opts('q27_study_goal'), required: true }] },
      {
        id: 'occupation', heading: 'Current occupation',
        fields: [
          { key: 'q31_occupation', type: 'select', label: 'Current occupation category', options: opts('q31_occupation'), required: true },
          { key: 'q32_employment_type', type: 'select', label: 'Current employment type', options: opts('q32_employment_type'), required: true },
        ],
      },
      {
        id: 'work-exp', heading: 'Work experience',
        fields: [
          { key: 'q29_years_work', type: 'select', label: 'Total years of work experience', options: opts('q29_years_work'), required: true },
          { key: 'q30_work_relevance', type: 'select', label: 'How related is your work experience to your intended study?', options: opts('q30_work_relevance'), required: true },
        ],
      },
    ],
  },
  {
    // PR-PHASE33-STEPS — 'Readiness & Timeline' was merged in here when the form
    // became multi-step. On its own it was three fields: a whole step, progress
    // bar and Next button, for three questions. The pairing is not just size —
    // both halves ask the same thing, "can you actually act?", in money,
    // paperwork and timing. The live /scorecard reached the same conclusion
    // independently; its section 3 is "Financial & operational readiness".
    // No scored key changed, so scoring is untouched.
    id: 5, title: 'Finances & Readiness',
    questions: [
      { id: 'funds', heading: 'Funds available', fields: [{ key: 'q33_funds', type: 'select', label: 'Funds available for study and settlement', options: opts('q33_funds'), required: true }] },
      { id: 'source', heading: 'Source of funds', fields: [{ key: 'q34_funds_source', type: 'select', label: 'Primary source of funds', options: opts('q34_funds_source'), required: true }] },
      { id: 'fin-docs', heading: 'Financial documents', fields: [{ key: 'q36_financial_docs', type: 'select', label: 'Are your financial documents ready (statements, translations)?', options: opts('q36_financial_docs'), required: true }] },
      {
        id: 'support', heading: 'Overseas bank & support',
        fields: [
          { key: 'q35_overseas_bank', type: 'select', label: 'Do you have an overseas bank account?', options: opts('q35_overseas_bank'), required: true },
          { key: 'q37_overseas_contacts', type: 'select', label: 'Do you have family or close contacts overseas?', options: opts('q37_overseas_contacts'), required: true },
          { key: 'q38_settlement_support', type: 'select', label: 'Will you have settlement support on arrival?', options: opts('q38_settlement_support'), required: true },
        ],
      },
      { id: 'passport', heading: 'Passport', fields: [{ key: 'q39_passport', type: 'select', label: 'Do you have a valid passport?', options: opts('q39_passport'), required: true }] },
      { id: 'docs-ready', heading: 'Documents ready', fields: [{ key: 'q40_docs_ready', type: 'select', label: 'Are all your application documents ready?', options: opts('q40_docs_ready'), required: true }] },
      { id: 'timeline', heading: 'Timeline', fields: [{ key: 'q41_apply_timeline', type: 'select', label: 'When do you want to apply?', options: opts('q41_apply_timeline'), required: true }] },
    ],
  },
  {
    id: 6, title: 'Immigration History',
    questions: [
      {
        id: 'refusal', heading: 'Visa refusals',
        fields: [
          { key: 'q44_refusal', type: 'select', label: 'Have you ever been refused a visa to any country?', options: opts('q44_refusal'), required: true },
          { key: 'q45_refusal_count', type: 'select', label: 'How many visa refusals?', options: opts('q45_refusal_count'), required: true, visibleWhen: refused },
          { key: 'q46_refusal_recency', type: 'select', label: 'When was the most recent refusal?', options: opts('q46_refusal_recency'), required: true, visibleWhen: refused },
        ],
      },
      { id: 'medical', heading: 'Medical', fields: [{ key: 'q47_medical', type: 'select', label: 'Any major medical conditions?', options: opts('q47_medical'), required: true }] },
      { id: 'police', heading: 'Police clearance', fields: [{ key: 'q48_police_clearance', type: 'select', label: 'Can you obtain a police clearance certificate?', options: opts('q48_police_clearance'), required: true }] },
      {
        id: 'breach', heading: 'Breach / identity',
        fields: [
          { key: 'q49_breach', type: 'select', label: 'Have you ever overstayed or breached a visa condition?', options: opts('q49_breach'), required: true },
          { key: 'q50_other_identity', type: 'select', label: 'Have you ever used a different name or identity?', options: opts('q50_other_identity'), required: true },
        ],
      },
      {
        id: 'prior', heading: 'Prior applications',
        fields: [
          { key: 'q51_self_submitted', type: 'select', label: 'Have you submitted any immigration application yourself before?', options: opts('q51_self_submitted'), required: true },
          { key: 'q52_other_agent', type: 'select', label: 'Are you currently working with another agent on this application?', options: opts('q52_other_agent'), required: true },
        ],
      },
    ],
  },
  {
    id: 7, title: 'Study Preferences',
    questions: [
      { id: 'preferred-fields', heading: 'Preferred field(s) of study', fields: [{ key: 'q32_preferred_fields', type: 'studyfield-multi', label: 'Preferred field(s) of study', required: true, helper: 'Restricted to fields related to your qualification, plus Business & Management.' }] },
      { id: 'desired-level', heading: 'Desired qualification level', fields: [{ key: 'q33_desired_level', type: 'select', label: 'Desired qualification level', options: ['CERTIFICATE', 'DIPLOMA', 'BACHELOR', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD'], required: true }] },
      { id: 'budget', heading: 'Tuition budget', fields: [{ key: 'q34_tuition_budget', type: 'number', label: 'Tuition budget per year (NZD)', required: false, helper: 'Approximate — helps rank affordable programmes.' }] },
      { id: 'location', heading: 'Preferred location', fields: [{ key: 'q43_city', type: 'select', label: 'Preferred location in New Zealand', options: opts('q43_city'), required: true }] },
      {
        id: 'work-plans', heading: 'Work plans',
        fields: [
          { key: 'q28_work_after_grad', type: 'select', label: 'Do you plan to work in NZ after graduation?', options: opts('q28_work_after_grad'), required: true },
          { key: 'q36_work_while_studying', type: 'boolean', label: 'Do you plan to work while studying?', required: false },
        ],
      },
      { id: 'target-occupation', heading: 'Target occupation (optional)', fields: [{ key: 'target_occupation', type: 'text', label: 'Target occupation after study', required: false }] },
    ],
  },
];

export const V2_ALL_FIELDS: V2FieldDef[] = ASSESSMENT_V2.flatMap((s) => s.questions.flatMap((q) => q.fields));
