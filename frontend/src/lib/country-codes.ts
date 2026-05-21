import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import faLocale from 'i18n-iso-countries/langs/fa.json';

// PR-CONSULT-4 — Country codes wrapper (frontend).
//
// Mirror of `backend/src/common/country-codes.ts` that also
// registers the Persian locale so the CountryPicker can display
// localised names on the `fa` side. Code itself is always the
// alpha-2 string.

countries.registerLocale(enLocale);
countries.registerLocale(faLocale);

export const ALL_COUNTRY_CODES: readonly string[] =
  Object.keys(countries.getAlpha2Codes());

// Localised name lookup. Falls back to the code itself if the
// library can't resolve it (extremely unlikely but keeps the UI
// from rendering "undefined").
export function getCountryName(code: string, locale: 'en' | 'fa'): string {
  return countries.getName(code, locale) ?? code;
}

// Regional-indicator-letter flag emoji. "NZ" → 🇳🇿 by mapping each
// ASCII letter to its U+1F1E6-base sibling. Safe for any
// well-formed alpha-2 code; returns "" for malformed input.
const REGIONAL_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);
export function countryCodeToFlagEmoji(code: string): string {
  if (typeof code !== 'string' || code.length !== 2) return '';
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(
    upper.charCodeAt(0) + REGIONAL_OFFSET,
    upper.charCodeAt(1) + REGIONAL_OFFSET,
  );
}

export interface SearchableCountry {
  code:       string;
  name:       string;
  flag:       string;
  searchText: string;
}

// Pre-computed catalogue for the CountryPicker. `searchText` is
// lowercased "name code" so a `.includes(query.toLowerCase())`
// match covers both name-typing and code-typing.
//
// Sorted alphabetically by display name, then by code as a tie-
// breaker for codes with identical localised names.
export function getSearchableCountries(locale: 'en' | 'fa'): SearchableCountry[] {
  const items = ALL_COUNTRY_CODES.map((code) => {
    const name = getCountryName(code, locale);
    return {
      code,
      name,
      flag:       countryCodeToFlagEmoji(code),
      searchText: `${name} ${code}`.toLowerCase(),
    };
  });
  items.sort((a, b) => a.name.localeCompare(b.name, locale) || a.code.localeCompare(b.code));
  return items;
}
