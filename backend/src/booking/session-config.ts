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
  /** Base price in whole units of `currency`. 0 = free. This is the SINGLE
   *  source of truth for the amount charged (card + wallet) and every display. */
  price: number;
  /** ISO 4217 currency for `price` (e.g. 'USD'). Drives Stripe + every display. */
  currency: string;
  /** Whether a Stripe payment must succeed before slot selection. */
  requiresPayment: boolean;
  /** Whether the adviser must be a User(role=LIA) with a verified LiaProfile. */
  requiresLia: boolean;
  /** Customer-facing label. */
  label: string;
}

export const SESSION_TYPES: Record<BookingSessionType, SessionTypeConfig> = {
  FREE_15: {
    type: 'FREE_15',
    durationMinutes: 15,
    price: 0,
    currency: 'USD',
    requiresPayment: false,
    requiresLia: false,
    label: 'Free 15-minute consultation',
  },
  GAP_CLOSING: {
    type: 'GAP_CLOSING',
    durationMinutes: 30,
    price: 20,
    currency: 'USD',
    requiresPayment: true,
    requiresLia: false,
    label: 'Gap-Closing session',
  },
  LIA: {
    type: 'LIA',
    durationMinutes: 45,
    price: 58,
    currency: 'USD',
    requiresPayment: true,
    requiresLia: true,
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
