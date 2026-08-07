// PR-PHASE33-STEPS — step model and validation for the multi-step assessment.
//
// Kept out of the page component so the rules can be tested without rendering,
// and so "which step is the first incomplete one" has exactly one definition
// rather than one per call site.

import { ASSESSMENT_V2, type V2FieldDef } from './assessment-v2';

/** The declaration is a real step: it has a position, a progress dot, and a gate. */
export const DECLARATION_STEP = ASSESSMENT_V2.length;

/** 7 content steps + the declaration. */
export const TOTAL_STEPS = ASSESSMENT_V2.length + 1;

export const STEP_TITLES: string[] = [
  ...ASSESSMENT_V2.map((s) => s.title),
  'Declaration',
];

type Answers = Record<string, unknown>;

export function isFieldVisible(f: V2FieldDef, answers: Answers): boolean {
  return !f.visibleWhen || f.visibleWhen(answers);
}

function isEmpty(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** One error per field key, keyed so the page can render it under the field. */
export type FieldErrors = Record<string, string>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function checkField(f: V2FieldDef, answers: Answers, errs: FieldErrors): void {
  if (!isFieldVisible(f, answers)) return;
  const v = answers[f.key];

  if (f.required && isEmpty(v)) {
    errs[f.key] = 'This answer is required.';
    return;
  }
  if (isEmpty(v)) return;

  if (f.type === 'email' && !EMAIL.test(String(v))) {
    errs[f.key] = 'Enter a valid email address.';
  }
  // PhoneInput can only emit '' or a well-formed E.164 string, so this guards
  // against a value restored from an older draft, not against typing.
  if (f.type === 'phone' && !String(v).startsWith('+')) {
    errs[f.key] = 'Enter a phone number including its country code.';
  }
}

/**
 * Validate ONE step. Used to gate Next.
 *
 * Only fields visible under the CURRENT answers are checked — a conditional
 * field the applicant cannot see must never block them.
 */
export function validateStep(step: number, answers: Answers): FieldErrors {
  const section = ASSESSMENT_V2[step];
  if (!section) return {}; // declaration step has no fields of its own
  const errs: FieldErrors = {};
  for (const q of section.questions) {
    if (q.visibleWhen && !q.visibleWhen(answers)) continue;
    for (const f of q.fields) checkField(f, answers, errs);
  }
  return errs;
}

export interface FullValidationResult {
  errors: FieldErrors;
  /** First step containing an error, or null when everything passes. */
  firstBadStep: number | null;
}

/**
 * Validate EVERY step before submit.
 *
 * Per-step gating alone is not sufficient, and this is the reason: visibility
 * is computed from the whole answer set, so an answer given on a LATER step can
 * reveal a required field on an EARLIER one the applicant has already passed.
 * Ten fields in this form are conditional, so this is a real path, not a
 * theoretical one. `firstBadStep` lets the page send them back to it.
 */
export function validateAll(answers: Answers): FullValidationResult {
  const errors: FieldErrors = {};
  let firstBadStep: number | null = null;

  for (let step = 0; step < ASSESSMENT_V2.length; step++) {
    const stepErrs = validateStep(step, answers);
    if (Object.keys(stepErrs).length > 0 && firstBadStep === null) firstBadStep = step;
    Object.assign(errors, stepErrs);
  }
  return { errors, firstBadStep };
}

/**
 * Keep a restored step index inside the current form.
 *
 * DRAFT_VERSION guards answer-shape changes, but the step count can shift
 * without any answer changing — merging two sections did exactly that. Clamping
 * is cheaper and more reliable than remembering to bump a version for it.
 */
export function clampStep(step: unknown): number {
  const n = typeof step === 'number' && Number.isFinite(step) ? Math.floor(step) : 0;
  return Math.min(Math.max(n, 0), TOTAL_STEPS - 1);
}
