import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

// PR-CONSULT-4 — Country codes wrapper.
//
// Thin facade over the `i18n-iso-countries` package so the rest of
// the backend doesn't import the library directly. The frontend has
// a parallel wrapper at `frontend/src/lib/country-codes.ts` that
// registers both `en` and `fa` locales for display purposes.
//
// We only ever store the ISO 3166-1 alpha-2 code on a User row
// (e.g. "NZ", "IR") — the human-readable name is resolved on read.
// The code itself stays plain text so we can filter / aggregate.

countries.registerLocale(enLocale);

// Canonical list of currently-recognised ISO 3166-1 alpha-2 codes.
// The library returns an `{ [code]: localizedName }` map; we only
// need the keys for validation.
export const ALL_COUNTRY_CODES: readonly string[] =
  Object.keys(countries.getAlpha2Codes());

const VALID_SET = new Set(ALL_COUNTRY_CODES);

// Server-side validator used by the staff-profile DTOs. Accepts
// only exactly-two-uppercase-letter codes that are in the live
// alpha-2 set. We deliberately don't accept lowercase here so the
// DTO surfaces an obvious "uppercase only" error in dev — the
// frontend uppercases before sending.
export function isValidCountryCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  if (code.length !== 2) return false;
  if (code !== code.toUpperCase()) return false;
  return VALID_SET.has(code);
}

// Resolve a code to its English name. Kept for log lines + audit
// metadata — the frontend handles user-facing display (en + fa).
// Returns the code itself when the lookup fails so log lines don't
// blow up on stale data.
export function getCountryName(code: string, locale: 'en' = 'en'): string {
  return countries.getName(code, locale) ?? code;
}
