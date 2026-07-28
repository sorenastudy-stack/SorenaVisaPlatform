import { api } from '@/lib/api';

// Client mirror of the backend BookingEligibilityService response
// (GET /booking/eligibility). Single source of truth for booking eligibility;
// consumed by the assessment report and the standing booking page so both agree
// by construction. Phase 30 (i18n): the payload now carries a stable
// `reasonCode` (+ optional `reasonParams`); `reasonText()` below maps it to a
// translated string, falling back to the server-provided English `reason`.

export type BookingType = 'FREE_15' | 'GAP_CLOSING' | 'LIA';
export type Band = 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';

export type BookingReasonCode =
  | 'NO_SUBMISSION'
  | 'FREE15_BAND'
  | 'FREE15_HARDSTOP'
  | 'FREE15_USED'
  | 'FREE15_OK'
  | 'GAP_BAND_MISMATCH'
  | 'GAP_HARDSTOP'
  | 'GAP_OK'
  | 'LIA_NO_ADVISER'
  | 'LIA_OK_HARDSTOP'
  | 'LIA_OK_GENERAL';

export interface TypeEligibility {
  type: BookingType;
  eligible: boolean;
  reason: string; // server English — fallback only
  reasonCode?: BookingReasonCode; // stable key → t('booking.reasons.<CODE>')
  reasonParams?: Record<string, string>;
  paid: boolean;
  currency: string;       // ISO 4217, e.g. 'USD'
  priceCents: number;     // base — the WALLET amount (no fee)
  cardFeeCents: number;   // disclosed card processing fee (0 when free)
  cardTotalCents: number; // priceCents + cardFeeCents — the CARD amount
}

// A next-intl translator scoped to `booking` — callable, with the runtime
// `has` guard exposed so we can fall back safely on an unmapped code.
type BookingTranslator = ((key: string, params?: Record<string, string>) => string) & {
  has?: (key: string) => boolean;
};

// Resolve the displayable reason: prefer the translated code, fall back to the
// server's English `reason` if the code is missing/unmapped. `t` must be scoped
// to the `booking` namespace (useTranslations('booking')). Kept here so the
// report and the booking page render identical Persian by construction.
export function reasonText(
  item: Pick<TypeEligibility, 'reason' | 'reasonCode' | 'reasonParams'>,
  t: BookingTranslator,
): string {
  if (!item.reasonCode) return item.reason;
  const key = `reasons.${item.reasonCode}`;
  if (t.has && !t.has(key)) return item.reason;
  return t(key, item.reasonParams);
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
