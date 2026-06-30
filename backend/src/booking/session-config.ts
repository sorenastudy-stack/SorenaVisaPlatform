// PR-BOOKING-1 — session type config map.
//
// Single source of truth for the three bookable session types: their
// duration, price, whether payment is required up front, and whether the
// adviser must be a verified LIA. Kept in code (not a DB table) on
// purpose — these change rarely and their amounts are coupled to the
// Stripe payment logic. The ConsultationType enum in Prisma carries the
// same keys (FREE_15 / GAP_CLOSING / LIA); durations/prices live ONLY
// here so there's one place to change them.

export type BookingSessionType = 'FREE_15' | 'GAP_CLOSING' | 'LIA';

// PR-BOOKING-4: how long a paid-booking slot is held (PENDING consultation
// with holdExpiresAt) while the client completes Stripe Checkout. Single
// source of truth — tune here.
export const BOOKING_HOLD_MINUTES = 15;

export interface SessionTypeConfig {
  type: BookingSessionType;
  durationMinutes: number;
  /** Price in NZD (whole dollars). 0 = free. */
  priceNZD: number;
  /** Whether a Stripe payment must succeed before slot selection. */
  requiresPayment: boolean;
  /** Whether the adviser must be a User(role=LIA) with a verified LiaProfile. */
  requiresLiaAdviser: boolean;
  /** Customer-facing label. */
  label: string;
}

export const SESSION_TYPES: Record<BookingSessionType, SessionTypeConfig> = {
  FREE_15: {
    type: 'FREE_15',
    durationMinutes: 15,
    priceNZD: 0,
    requiresPayment: false,
    requiresLiaAdviser: false,
    label: 'Free 15-minute consultation',
  },
  GAP_CLOSING: {
    type: 'GAP_CLOSING',
    durationMinutes: 30,
    priceNZD: 30,
    requiresPayment: true,
    requiresLiaAdviser: false,
    label: 'Gap-Closing session',
  },
  LIA: {
    type: 'LIA',
    durationMinutes: 45,
    priceNZD: 150,
    requiresPayment: true,
    requiresLiaAdviser: true,
    label: 'LIA Consultation',
  },
};

export function isBookingSessionType(value: string): value is BookingSessionType {
  return value === 'FREE_15' || value === 'GAP_CLOSING' || value === 'LIA';
}

export function getSessionConfig(type: BookingSessionType): SessionTypeConfig {
  const cfg = SESSION_TYPES[type];
  if (!cfg) {
    throw new Error(`Unknown booking session type: ${type}`);
  }
  return cfg;
}
