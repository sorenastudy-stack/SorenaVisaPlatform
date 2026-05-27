// PR-SCORECARD-2 — English-only labels for the public scorecard surface.
//
// Persian was intentionally removed from the SCORECARD FLOW ONLY in
// the Fix 9 batch — the LIA portal, student portal, and staff
// portals retain their Persian translations. If the scorecard market
// expands to bilingual users later, restore translations here and in
// `routing.ts` (backend); the BilingualString type is preserved as
// `LegacyBilingual` so a future PR can wire it back without breaking
// the file shape.
//
// Why a labels file (and not next-intl keys): the questionnaire alone
// has 53 questions × multiple options. Adding hundreds of next-intl
// keys for an English-only surface is unnecessary noise.

// Kept as an alias for any future re-introduction of bilingual labels.
// Today, "label" is a plain string and the T() / b() helpers are
// no-ops that pass strings through verbatim.
export interface LegacyBilingual {
  en: string;
  fa?: string;
}

// Pass-through: every label IS the displayed string. The `_locale`
// parameter is kept (optional) for any caller that still threads it
// through — it's ignored.
export const T = (s: string, _locale?: unknown): string => s;

// Helper: the second `fa` parameter is accepted but ignored. Allows
// callers that haven't been migrated yet to keep compiling without
// edits. New call sites should just pass the English string directly.
export const b = (en: string, _fa?: string): string => en;

// ─── LANDING PAGE ────────────────────────────────────────────────────

export const LANDING_STRINGS = {
  heroTagline:     'Take the free readiness assessment',
  heroTitle:       'Discover Your Path to Studying Abroad',
  heroSubtitle:    'A 10-minute, 100-point assessment that scores your profile across 4 dimensions and gives you a personalised next step.',
  heroCta:         'Start Free Assessment →',
  valueCard1Title: '10-minute assessment',
  valueCard1Body:  '53 short questions across profile, academic, financial, and risk dimensions.',
  valueCard2Title: 'Personalised pathway',
  valueCard2Body:  'We map your score to one of 6 readiness bands and a concrete next action — not a sales pitch.',
  valueCard3Title: 'Zero cost to start',
  valueCard3Body:  'The assessment is free. If you reach the top bands, our consultation is free too.',
  trustAuthorizedAgent: 'Authorised agent for New Zealand and Malaysian universities',
  signinHint:      'Already have an account?',
  signinLink:      'Sign in',
};

// ─── FORM SECTIONS ───────────────────────────────────────────────────

export const FORM_SECTIONS = [
  {
    id: 0,
    title:       'Your details',
    description: 'We need a way to send you your results.',
    maxPoints:   0,
  },
  {
    id: 1,
    title:       'Profile & migration stability',
    description: 'Basics about you, your family, and your travel history.',
    maxPoints:   20,
  },
  {
    id: 2,
    title:       'Academic & career foundation',
    description: 'Your qualifications, English level, and career trajectory.',
    maxPoints:   35,
  },
  {
    id: 3,
    title:       'Financial & operational readiness',
    description: 'Funds, documents, and how soon you can act.',
    maxPoints:   25,
  },
  {
    id: 4,
    title:       'Immigration & risk assessment',
    description: 'Past visa history, medical, and identity questions.',
    maxPoints:   20,
  },
];

// ─── FORM UI LABELS ──────────────────────────────────────────────────

export const FORM_UI = {
  progressLabel:    'Step {current} of {total}',
  next:             'Save & next →',
  previous:         '← Previous',
  submit:           'Submit assessment',
  submitting:       'Submitting…',
  saving:           'Saving…',
  saved:            'Saved',
  saveErrorBanner:  'Could not save — please check your connection and try again.',
  fieldRequired:    'This field is required.',
  invalidEmail:     'Please enter a valid email address.',
  invalidPhone:     'Phone must start with + and the country code.',
  conditionalSkip:  'Based on your previous answer, the next questions are not relevant.',
  declarationTitle: 'Declaration & consent',
  declarationBody:  'I confirm that the information I have provided is accurate to the best of my knowledge. I understand that Sorena Visa will store and process this information to generate my readiness assessment and may contact me about the results.',
  declarationAgree: 'I agree',
  resumeBanner:     'We restored your in-progress assessment.',
};

// ─── RESULT PAGE ─────────────────────────────────────────────────────

export const RESULT_STRINGS = {
  headerTitle:          'Your assessment result',
  generatedOn:          'Generated on {date}',
  totalScoreLabel:      'Total score',
  bandLabel:            'Band',
  executionEligible:    'Execution eligible',
  notYetEligible:       'Not yet eligible',
  hardStopsTitle:       'Hard stops',
  riskFlagsTitle:       'Risk flags',
  fiveGateTitle:        'Execution eligibility — 5-gate check',
  categoryBreakdown:    'Category breakdown',
  nextActionTitle:      'Your next best action',
  malaysiaCalloutTitle: 'You also qualify for Malaysia',
  malaysiaCalloutBody:  'You are eligible for both New Zealand AND Malaysia. As a Sorena-certified agent for both countries, we charge no service fees — universities pay us a commission upon successful enrollment. You only pay the INZ visa fee + our one-time USD 200 account opening fee.',
  bookFreeCta:          'Book your free 15-minute consultation →',
  bookFreeSubtitle:     "Opens our booking calendar. You'll select a time that works for you.",
  bookFreeRecorded:     'Booking link opened. Your case advisor has been notified.',
  payGapTitle:          'Your next step: Gap-Closing Roadmap Session',
  payGapBody:           'Once payment is received, you will receive a personalised AI-generated improvement plan and a booking link with a language-matched specialist.',
  payGapCta:            'Pay NZD 30 and book your Gap-Closing Session →',
  payGapSubtitle:       "After payment, you'll receive a personalised improvement plan and your booking link.",
  payGapRecorded:       'Payment link opened. Your case advisor has been notified.',
  nurtureTitle:         'We have designed a learning pathway tailored to your profile',
  nurtureBody:          'Free resources to help you build readiness over the next 3-6 months. We will email you a personalised learning plan.',
  blockedTitle:         'There is a blocker on your profile',
  blockedBody:          'Please review the hard stops below — your case advisor will reach out to discuss how to resolve them.',
  fullAnswerLog:        'Full answer log',
  downloadPdfCta:       'Download report (PDF)',
  pdfComingSoon:        'PDF download coming soon. Your case advisor has a copy.',
  backToDashboard:      'Back to dashboard',
  bookingError:         'Could not register your booking request. Please try again.',
};

// ─── BAND DISPLAY METADATA ───────────────────────────────────────────

export const BAND_META: Record<string, { name: string; range: string; color: string }> = {
  BAND_1: { name: 'Cold / Unready',                  range: '0-24',   color: 'gray' },
  BAND_2: { name: 'Early Stage / Fragile',           range: '25-39',  color: 'blue' },
  BAND_3: { name: 'Developing / Consultable',        range: '40-54',  color: 'amber' },
  BAND_4: { name: 'Viable / Structured Opportunity', range: '55-69',  color: 'orange' },
  BAND_5: { name: 'Strong / Near Execution Ready',   range: '70-84',  color: 'violet' },
  BAND_6: { name: 'Premium / Execution Ready',       range: '85-100', color: 'emerald' },
};

export const CATEGORY_META: Record<number, { name: string; max: number }> = {
  1: { name: 'Profile & migration stability',     max: 20 },
  2: { name: 'Academic & career foundation',      max: 35 },
  3: { name: 'Financial & operational readiness', max: 25 },
  4: { name: 'Immigration & risk assessment',     max: 20 },
};
