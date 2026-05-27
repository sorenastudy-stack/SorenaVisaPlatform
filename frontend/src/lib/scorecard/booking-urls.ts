// PR-SCORECARD-2 — Booking destination URLs.
//
// PLACEHOLDER URLS — to be replaced with the real Wix Bookings link
// (Bands 4-6) and Stripe checkout links (Band 3 + LIA) in future PRs:
//
//   * FREE_15MIN          → PR-SCORECARD-5 (Wix Bookings integration)
//   * GAP_CLOSING_PAYMENT → PR-SCORECARD-4 (Stripe NZD 30 checkout
//                                            for the Gap-Closing Session)
//   * LIA_CONSULTATION    → PR-SCORECARD-4 (Stripe NZD 150 checkout
//                                            for the LIA consultation —
//                                            shown to hard-stop cases
//                                            in Bands 3+ per Strategic
//                                            Session v4.0 Table 12)
//
// When those PRs land, the simplest swap is to (a) move these into
// PlatformSetting rows so OWNER can edit them without a deploy, and
// (b) extend with per-language Wix calendars (e.g. {en, fa} maps).
// For now the constants live here so callers don't bake the strings
// into JSX — making the future replacement a single-file change.

export const BOOKING_URLS = {
  FREE_15MIN:          'https://www.sorenavisa.com/book-free-consultation',
  GAP_CLOSING_PAYMENT: 'https://www.sorenavisa.com/gap-closing-session-payment',
  LIA_CONSULTATION:    'https://www.sorenavisa.com/lia-consultation-payment',
} as const;
