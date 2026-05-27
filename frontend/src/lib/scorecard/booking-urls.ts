// PR-SCORECARD-2 — Booking destination URLs.
//
// PLACEHOLDER URLS — to be replaced with the real Wix Bookings link
// (Bands 4-6) and Stripe checkout link (Band 3) in future PRs:
//
//   * FREE_15MIN          → PR-SCORECARD-5 (Wix Bookings integration)
//   * GAP_CLOSING_PAYMENT → PR-SCORECARD-4 (Stripe checkout for the
//                                            NZD 30 Gap-Closing Session)
//
// When those PRs land, the simplest swap is to (a) move these into
// PlatformSetting rows so OWNER can edit them without a deploy, and
// (b) extend with per-language Wix calendars (e.g. {en, fa} maps).
// For now the constants live here so callers don't bake the strings
// into JSX — making the future replacement a single-file change.

export const BOOKING_URLS = {
  FREE_15MIN:          'https://www.sorenavisa.com/book-free-consultation',
  GAP_CLOSING_PAYMENT: 'https://www.sorenavisa.com/gap-closing-session-payment',
} as const;
