// PR-SCORECARD-2 — Question schema for the public scorecard form.
//
// IMPORTANT: option strings are VERBATIM from the scoring engine's
// SCORES table (backend/src/scorecard/scoring/scores.ts). Do not "fix"
// capitalisation or spacing — the engine matches answer values
// exactly (with a case-insensitive trimmed fallback). The exact
// strings also appear in audit logs and the eventual PDF.
//
// Conditional rendering rules:
//   * q05_military          — only if q04_gender === 'Male'
//   * q07_marriage_years    — only if q06_marital in ['Married', 'Divorced']
//   * q09/q10/q11 (partner) — only if q06_marital === 'Married'
//   * q45_refusal_count     — only if q44_refusal === 'Yes'
//   * q46_refusal_recency   — only if q44_refusal === 'Yes'
//
// The conditional logic is mirrored on the backend scoring engine
// (which simply scores whatever it's given) — there's no risk of
// a hidden answer affecting the total because skipped questions
// land as `undefined` (0 points).
//
// Persian question wording is intentionally NOT included in this PR
// per the handover — translation requires expert review and the
// scope was already large. Question text renders in English under
// both locales; section headings and UI labels are bilingual.

import { b, BilingualString } from './labels';

export type QuestionType = 'text' | 'email' | 'phone' | 'select' | 'longtext';

export interface QuestionDef {
  id: string;
  type: QuestionType;
  label: BilingualString;
  options?: string[];
  required?: boolean;
  // Returns true when this question should be VISIBLE / required.
  // Hidden questions are skipped (not scored).
  visibleWhen?: (answers: Record<string, string>) => boolean;
  // Optional helper text shown beneath the label.
  helper?: BilingualString;
}

export interface FormSection {
  id: number;
  questionIds: string[];
}

// ─── SECTION 0 — CONTACT DETAILS ─────────────────────────────────────

export const CONTACT_QUESTIONS: QuestionDef[] = [
  {
    id: 'full_name',
    type: 'text',
    label: b('Full name', 'نام کامل'),
    required: true,
  },
  {
    id: 'email',
    type: 'email',
    label: b('Email address', 'آدرس ایمیل'),
    required: true,
  },
  {
    id: 'phone',
    type: 'phone',
    label: b('Phone (with country code, e.g. +98 …)', 'تلفن (با کد کشور، مثلاً +98 …)'),
    required: true,
  },
  {
    id: 'current_country',
    type: 'text',
    label: b('Current country of residence', 'کشور محل سکونت فعلی'),
    required: true,
  },
];

// ─── SECTION 1 — PROFILE & MIGRATION STABILITY ───────────────────────

export const SECTION_1_QUESTIONS: QuestionDef[] = [
  {
    id: 'q01_motivation',
    type: 'select',
    label: b('How would you describe your motivation to study and migrate?', 'انگیزه شما برای تحصیل و مهاجرت را چگونه توصیف می‌کنید؟'),
    options: ['Very High', 'High', 'Medium', 'Low'],
    required: true,
  },
  {
    id: 'q02_migrate_before_family',
    type: 'select',
    label: b('Are you open to migrating before bringing family?', 'آیا تمایل دارید قبل از همراهی خانواده، مهاجرت کنید؟'),
    options: ['Yes', 'Maybe', 'No'],
    required: true,
  },
  {
    id: 'q03_age',
    type: 'select',
    label: b('What is your age range?', 'بازه سنی شما؟'),
    options: ['Under 18', '18 - 21', '22 - 29', '30 - 39', '40 - 49', '50+'],
    required: true,
  },
  {
    id: 'q04_gender',
    type: 'select',
    label: b('Gender', 'جنسیت'),
    options: ['Male', 'Female', 'Prefer not to say'],
    required: true,
  },
  {
    id: 'q05_military',
    type: 'select',
    label: b('Military service status', 'وضعیت خدمت سربازی'),
    options: ['Completed', 'Exempted', 'Not applicable', 'Not completed'],
    required: true,
    visibleWhen: (a) => a.q04_gender === 'Male',
  },
  {
    id: 'q06_marital',
    type: 'select',
    label: b('Marital status', 'وضعیت تأهل'),
    options: ['Single', 'Married', 'Divorced', 'Widowed'],
    required: true,
  },
  {
    id: 'q07_marriage_years',
    type: 'select',
    label: b('How many years have you been married?', 'چند سال است که ازدواج کرده‌اید؟'),
    options: ['Less than 1 year', '1 - 3 years', '3+ years', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married' || a.q06_marital === 'Divorced',
  },
  {
    id: 'q08_children',
    type: 'select',
    label: b('Number of children', 'تعداد فرزندان'),
    options: ['0', '1', '2', '3 or more'],
    required: true,
  },
  {
    id: 'q09_partner_age',
    type: 'select',
    label: b('Partner age range', 'بازه سنی همسر'),
    options: ['Under 35', '35 - 45', '46+', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married',
  },
  {
    id: 'q10_partner_edu',
    type: 'select',
    label: b('Partner highest qualification', 'بالاترین مدرک تحصیلی همسر'),
    options: ['Bachelor or higher', 'Diploma', 'High School', 'No qualification', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married',
  },
  {
    id: 'q11_partner_english',
    type: 'select',
    label: b('Partner English level', 'سطح زبان انگلیسی همسر'),
    options: ['IELTS / PTE equivalent', 'Basic English', 'No English', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q06_marital === 'Married',
  },
  {
    id: 'q12_other_citizenship',
    type: 'select',
    label: b('Do you hold or are you eligible for another citizenship?', 'آیا تابعیت دیگری دارید یا واجد شرایط آن هستید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q13_travel_history',
    type: 'select',
    label: b('How would you describe your international travel history?', 'سابقه سفر بین‌المللی شما چگونه است؟'),
    options: ['Multiple visa-requiring countries', 'Limited travel', 'Regional travel only', 'No international travel'],
    required: true,
  },
  {
    id: 'q14_visa_countries_type',
    type: 'select',
    label: b('Have you held visas for any of the following?', 'آیا برای موارد زیر ویزا گرفته‌اید؟'),
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
    label: b('Highest qualification', 'بالاترین مدرک تحصیلی'),
    options: ['High School', 'Diploma', 'Associate Degree', 'Bachelor', 'Master', 'PhD'],
    required: true,
  },
  {
    id: 'q16_field_main',
    type: 'select',
    label: b('Field of your highest qualification', 'رشته بالاترین مدرک تحصیلی'),
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
    label: b('Academic GPA / grade band', 'معدل تحصیلی / رتبه کلاسی'),
    options: ['Excellent (top 10%)', 'Good (above average)', 'Average', 'Weak (below average)'],
    required: true,
  },
  {
    id: 'q18_years_since',
    type: 'select',
    label: b('Years since you finished your highest qualification', 'چند سال از پایان آخرین مدرک تحصیلی شما می‌گذرد؟'),
    options: ['Less than 2 years', '2 - 5 years', '5 - 10 years', '10+ years'],
    required: true,
  },
  {
    id: 'q19_docs_translated',
    type: 'select',
    label: b('Are your academic documents translated and certified?', 'آیا مدارک تحصیلی شما ترجمه و تأیید شده‌اند؟'),
    options: ['Yes - fully translated', 'Partially', 'No'],
    required: true,
  },
  {
    id: 'q20_publications',
    type: 'select',
    label: b('Do you have any academic publications, patents, or research output?', 'آیا انتشارات علمی، ثبت اختراع یا پژوهش دارید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q21_english_cert',
    type: 'select',
    label: b('English certificate type', 'نوع مدرک زبان انگلیسی'),
    options: ['IELTS Academic', 'IELTS General', 'PTE', 'TOEFL', 'Duolingo', 'NZCEL', 'Expired certificate', 'No certificate'],
    required: true,
  },
  {
    id: 'q22_english_score',
    type: 'select',
    label: b('English score (approximate IELTS-equivalent)', 'نمره زبان انگلیسی (تقریباً معادل آیلتس)'),
    options: ['IELTS 7+ / equivalent', 'IELTS 6 - 6.5', 'IELTS 5 - 5.5', 'Below IELTS 5', 'No test taken'],
    required: true,
  },
  {
    id: 'q23_test_date',
    type: 'select',
    label: b('When did you take your English test?', 'آزمون زبان خود را چه زمانی داده‌اید؟'),
    options: ['Less than 1 year ago', '1 - 2 years ago', 'Expired (more than 2 years)', 'No test taken'],
    required: true,
  },
  {
    id: 'q24_studied_english',
    type: 'select',
    label: b('Have you previously studied in English?', 'آیا قبلاً به زبان انگلیسی تحصیل کرده‌اید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q25_intended_study',
    type: 'select',
    label: b('Intended study field', 'رشته تحصیلی مورد نظر شما'),
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
    label: b('Are you changing fields (different from your previous qualification)?', 'آیا قصد تغییر رشته نسبت به مدرک قبلی را دارید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q27_study_goal',
    type: 'select',
    label: b('Primary goal for studying abroad', 'هدف اصلی شما از تحصیل در خارج'),
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
    label: b('Do you plan to work in NZ after graduation?', 'آیا قصد دارید پس از فارغ‌التحصیلی در نیوزیلند کار کنید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q29_years_work',
    type: 'select',
    label: b('Total years of work experience', 'مجموع سال‌های سابقه کاری'),
    options: ['None', '1 - 2 years', '3 - 5 years', '5 - 10 years', '10+ years'],
    required: true,
  },
  {
    id: 'q30_work_relevance',
    type: 'select',
    label: b('How related is your work experience to your intended study?', 'سابقه کاری شما چقدر به رشته مورد نظر مرتبط است؟'),
    options: ['Fully related', 'Partially related', 'Unrelated'],
    required: true,
  },
  {
    id: 'q31_occupation',
    type: 'select',
    label: b('Current occupation category', 'دسته شغلی فعلی شما'),
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
    label: b('Current employment type', 'نوع اشتغال فعلی'),
    options: ['Full-time', 'Part-time', 'Self-employed', 'Business owner', 'Unemployed'],
    required: true,
  },
];

// ─── SECTION 3 — FINANCIAL & OPERATIONAL READINESS ───────────────────

export const SECTION_3_QUESTIONS: QuestionDef[] = [
  {
    id: 'q33_funds',
    type: 'select',
    label: b('Funds available for study and settlement', 'سرمایه قابل دسترس برای تحصیل و اقامت'),
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
    label: b('Primary source of funds', 'منبع اصلی سرمایه'),
    options: ['Personal savings', 'Business income', 'Family support', 'Sponsor support', 'Mixed sources'],
    required: true,
  },
  {
    id: 'q35_overseas_bank',
    type: 'select',
    label: b('Do you have an overseas (non-Iranian) bank account?', 'آیا حساب بانکی خارج از کشور (غیر ایران) دارید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q36_financial_docs',
    type: 'select',
    label: b('Are your financial documents ready (statements, translations)?', 'آیا مدارک مالی شما آماده‌اند (صورت‌حساب‌ها و ترجمه)؟'),
    options: ['Yes - fully', 'Partially', 'No'],
    required: true,
  },
  {
    id: 'q37_overseas_contacts',
    type: 'select',
    label: b('Do you have family or close contacts overseas?', 'آیا اقوام یا روابط نزدیک در خارج از کشور دارید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q38_settlement_support',
    type: 'select',
    label: b('Will you have settlement support on arrival?', 'آیا هنگام ورود از حمایت اقامتی برخوردار خواهید بود؟'),
    options: ['Yes', 'Maybe', 'No'],
    required: true,
  },
  {
    id: 'q39_passport',
    type: 'select',
    label: b('Do you have a valid passport?', 'آیا گذرنامه معتبر دارید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q40_docs_ready',
    type: 'select',
    label: b('Are all your application documents ready?', 'آیا تمام مدارک درخواست شما آماده‌اند؟'),
    options: ['Fully ready', 'Partially ready', 'Not ready'],
    required: true,
  },
  {
    id: 'q41_apply_timeline',
    type: 'select',
    label: b('When do you want to apply?', 'چه زمانی قصد ارسال درخواست را دارید؟'),
    options: ['Immediately', 'Within 1 month', 'Within 3 months', '6+ months'],
    required: true,
  },
  {
    id: 'q42_intake',
    type: 'select',
    label: b('Preferred intake', 'دوره تحصیلی مورد ترجیح'),
    options: ['ASAP', 'Next intake', '6 months later', 'Flexible'],
    required: true,
  },
  {
    id: 'q43_city',
    type: 'select',
    label: b('Preferred city in New Zealand', 'شهر مورد ترجیح در نیوزیلند'),
    options: ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Dunedin', 'Flexible'],
    required: true,
  },
];

// ─── SECTION 4 — IMMIGRATION & RISK ASSESSMENT ───────────────────────

export const SECTION_4_QUESTIONS: QuestionDef[] = [
  {
    id: 'q44_refusal',
    type: 'select',
    label: b('Have you ever been refused a visa to any country?', 'آیا تاکنون درخواست ویزای شما برای هیچ کشوری رد شده است؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q45_refusal_count',
    type: 'select',
    label: b('How many visa refusals?', 'چند بار درخواست ویزای شما رد شده است؟'),
    options: ['1', '2', '3 or more', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q44_refusal === 'Yes',
  },
  {
    id: 'q46_refusal_recency',
    type: 'select',
    label: b('When was the most recent refusal?', 'آخرین رد درخواست چه زمانی بود؟'),
    options: ['Less than 6 months ago', '6 - 12 months ago', '1 - 2 years ago', 'More than 2 years ago', 'Not applicable'],
    required: true,
    visibleWhen: (a) => a.q44_refusal === 'Yes',
  },
  {
    id: 'q47_medical',
    type: 'select',
    label: b('Any major medical conditions?', 'آیا مشکل پزشکی جدی دارید؟'),
    options: ['No major issues', 'Minor / manageable conditions', 'Serious / unresolved'],
    required: true,
  },
  {
    id: 'q48_police_clearance',
    type: 'select',
    label: b('Can you obtain a police clearance certificate?', 'آیا می‌توانید گواهی سوءپیشینه (Police Clearance) دریافت کنید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q49_breach',
    type: 'select',
    label: b('Have you ever overstayed or breached a visa condition?', 'آیا تاکنون از مدت ویزا تجاوز یا شرایط آن را نقض کرده‌اید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q50_other_identity',
    type: 'select',
    label: b('Have you ever used a different name or identity?', 'آیا تاکنون از نام یا هویت دیگری استفاده کرده‌اید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q51_self_submitted',
    type: 'select',
    label: b('Have you submitted any immigration application yourself before?', 'آیا قبلاً خودتان درخواست مهاجرتی را شخصاً ارسال کرده‌اید؟'),
    options: ['Yes', 'No'],
    required: true,
  },
  {
    id: 'q52_other_agent',
    type: 'select',
    label: b('Are you currently working with another agent on this application?', 'آیا در حال حاضر با ایجنت دیگری روی این درخواست همکاری می‌کنید؟'),
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
