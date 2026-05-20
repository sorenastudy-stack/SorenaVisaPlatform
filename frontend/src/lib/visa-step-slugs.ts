// PR-DASH-1 — Map from step number to the visa-section URL slug.
//
// The Visa Section is served at /student/documents and the active step
// is controlled by the in-memory VisaFormContext, not by URL. The
// dashboard "Continue your application" button still wants to deep-link
// to the right step though — and once we add per-step URL routes (or a
// query-string variant) this map will be the single source of truth.
//
// For now, every slug resolves to /student/documents (with the step
// captured in localStorage on the shell's first render). The slug is
// kept as a stable identifier so URL handling can be added without
// touching every component that calls visaStepHref().
export const VISA_STEP_SLUGS: Record<number, string> = {
  1:  'step-1-identity-details',
  2:  'step-2-address-contact',
  3:  'step-3-eligibility',
  4:  'step-4-character',
  5:  'step-5-health',
  6:  'step-6-education-history',
  7:  'step-7-employment-history',
  8:  'step-8-relationships',
  9:  'step-9-background-details',
  10: 'step-10-military-history',
  11: 'step-11-travel-history',
  12: 'step-12-immigration-assistance',
  13: 'step-13-supporting-documents',
  14: 'step-14-supporting-documents-2',
};

// Resolves the URL the dashboard should send the student to for a
// given visa step. Today this is the single /student/documents route
// with the step number encoded as the `step` query param — the shell
// reads it on mount and calls setActiveStep(N).
export function visaStepHref(step: number): string {
  const clamped = Math.max(1, Math.min(14, Math.floor(step)));
  return `/student/documents?step=${clamped}`;
}
