import { api } from '@/lib/api';

// Client mirror of the backend BookingEligibilityService response
// (GET /booking/eligibility). Single source of truth for booking eligibility;
// consumed by the assessment report and (next) the standing booking page so
// both agree by construction. Reason copy is server-provided English — no
// next-intl keys (Persian frozen).

export type BookingType = 'FREE_15' | 'GAP_CLOSING' | 'LIA';
export type Band = 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';

export interface TypeEligibility {
  type: BookingType;
  eligible: boolean;
  reason: string;
  paid: boolean;
  currency: string;       // ISO 4217, e.g. 'USD'
  priceCents: number;     // base — the WALLET amount (no fee)
  cardFeeCents: number;   // disclosed card processing fee (0 when free)
  cardTotalCents: number; // priceCents + cardFeeCents — the CARD amount
}

// Format integer cents in `currency` — the ONLY money formatter for sessions.
// No bare '$', no hardcoded currency code.
export function money(cents: number, currency: string): string {
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

export interface BookingEligibility {
  hasSubmission: boolean;
  band: Band | null;
  liveHardStop: boolean;
  hardStopSource: 'case' | 'submission' | null;
  types: TypeEligibility[];
  primaryType: BookingType | null;
}

export function getBookingEligibility(): Promise<BookingEligibility> {
  return api.get<BookingEligibility>('/booking/eligibility');
}

export function findType(
  elig: BookingEligibility | null,
  type: BookingType,
): TypeEligibility | undefined {
  return elig?.types.find((t) => t.type === type);
}
