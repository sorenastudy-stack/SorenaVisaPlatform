// PR-COUNTRY-PHONE — E.164 composition and parsing.
//
// The platform-wide rule is that a phone number is entered as (searchable
// country dropdown) + (digits), but STORED as it always has been: one string.
// That keeps this change UI-only — no migration, no backfill, and the existing
// backend validators (`PHONE_REGEX`, "must start with +") keep passing.
//
// Deliberately hand-rolled rather than pulling in libphonenumber-js (~150 kB):
// we need composition and a tolerant parse, not per-country length/format
// validation. What we do NOT claim is that the result is a number that exists —
// only that it is well-formed E.164.

import { getDialCode, dialCodeToCountry, DIAL_CODES } from './country-codes';

/** E.164 allows at most 15 digits in total, including the country code. */
export const E164_MAX_DIGITS = 15;

/** Matches a well-formed E.164 string: '+', then 1–15 digits, first non-zero. */
export const E164_PATTERN = /^\+[1-9]\d{0,14}$/;

// Countries where the national trunk prefix '0' is part of the subscriber
// number and must NOT be stripped. Italy is the canonical case (and Vatican
// City shares its +39 numbering plan).
const KEEPS_TRUNK_ZERO = new Set(['IT', 'VA']);

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/**
 * Build one E.164 string from a country and whatever the user typed.
 *
 * Everything non-numeric is discarded, so "021 555 1234", "(021) 555-1234" and
 * "021-555-1234" all give the same result. The leading trunk zero people are
 * used to dialling domestically is dropped, because in E.164 the country code
 * replaces it — that is the single most common way a hand-typed international
 * number ends up wrong.
 *
 * Returns '' when there is nothing to build (no country, or no digits), so an
 * untouched optional field stays empty rather than becoming a bare '+64'.
 */
export function composeE164(iso2: string | null | undefined, nationalInput: string): string {
  const dial = getDialCode(iso2);
  if (!dial) return '';

  let digits = nationalInput.replace(/\D/g, '');
  if (!KEEPS_TRUNK_ZERO.has(String(iso2).toUpperCase())) {
    digits = digits.replace(/^0+/, '');
  }
  if (!digits) return '';

  // Truncate rather than emit an over-long string: E.164 is capped at 15
  // digits and a longer value would fail the pattern for every consumer.
  const full = `${dial}${digits}`.slice(0, E164_MAX_DIGITS);
  return `+${full}`;
}

export interface ParsedPhone {
  /** Alpha-2 country the number's calling code resolves to. */
  iso2:     string;
  /** Subscriber digits after the calling code. May be ''. */
  national: string;
}

/**
 * Split a stored number back into (country, national digits) so an edit form
 * can hydrate the picker. Tolerant by design — the six fields this replaces
 * hold years of free-text like "+64 21 555 1234", "0064 21 …" and "+98-912-…".
 *
 * Returns null when no calling code can be identified; the caller then falls
 * back to its default country and treats the whole value as national digits.
 */
export function parseE164(value: string | null | undefined): ParsedPhone | null {
  if (!value) return null;

  let digits = String(value).trim().replace(/\D/g, '');
  if (!digits) return null;

  // "0064…" — the international access prefix written out instead of '+'.
  if (!String(value).trim().startsWith('+') && digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Longest calling code wins: +1264 (Anguilla) must beat +1 (NANP).
  for (let len = 4; len >= 1; len--) {
    const candidate = digits.slice(0, len);
    const iso2 = dialCodeToCountry(candidate);
    if (iso2) return { iso2, national: digits.slice(len) };
  }
  return null;
}

/** Every alpha-2 country that has a calling code, for tests and callers. */
export const DIALLABLE_COUNTRIES: readonly string[] = Object.keys(DIAL_CODES);
