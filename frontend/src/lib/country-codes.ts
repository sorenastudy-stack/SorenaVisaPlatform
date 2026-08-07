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

// PR-COUNTRY-PHONE — international dialling (calling) codes, ISO 3166-1
// alpha-2 → ITU-T E.164 country calling code, WITHOUT the leading '+'.
//
// Lives here rather than in a phone-specific module because it is country
// reference data, same as the name/flag catalogue above; `lib/phone.ts` owns
// the E.164 composition rules that consume it.
//
// Several codes are shared (NANP +1, RU/KZ +7, GB/JE/GG/IM +44, IT/VA +39 …).
// That is expected: the map is many-to-one on purpose. `dialCodeToCountry()`
// below picks one canonical country per code for the reverse direction.
export const DIAL_CODES: Readonly<Record<string, string>> = {
  AD: '376',  AE: '971',  AF: '93',   AG: '1268', AI: '1264', AL: '355',
  AM: '374',  AO: '244',  AQ: '672',  AR: '54',   AS: '1684', AT: '43',
  AU: '61',   AW: '297',  AX: '358',  AZ: '994',  BA: '387',  BB: '1246',
  BD: '880',  BE: '32',   BF: '226',  BG: '359',  BH: '973',  BI: '257',
  BJ: '229',  BL: '590',  BM: '1441', BN: '673',  BO: '591',  BQ: '599',
  BR: '55',   BS: '1242', BT: '975',  BV: '47',   BW: '267',  BY: '375',
  BZ: '501',  CA: '1',    CC: '61',   CD: '243',  CF: '236',  CG: '242',
  CH: '41',   CI: '225',  CK: '682',  CL: '56',   CM: '237',  CN: '86',
  CO: '57',   CR: '506',  CU: '53',   CV: '238',  CW: '599',  CX: '61',
  CY: '357',  CZ: '420',  DE: '49',   DJ: '253',  DK: '45',   DM: '1767',
  DO: '1809', DZ: '213',  EC: '593',  EE: '372',  EG: '20',   EH: '212',
  ER: '291',  ES: '34',   ET: '251',  FI: '358',  FJ: '679',  FK: '500',
  FM: '691',  FO: '298',  FR: '33',   GA: '241',  GB: '44',   GD: '1473',
  GE: '995',  GF: '594',  GG: '44',   GH: '233',  GI: '350',  GL: '299',
  GM: '220',  GN: '224',  GP: '590',  GQ: '240',  GR: '30',   GS: '500',
  GT: '502',  GU: '1671', GW: '245',  GY: '592',  HK: '852',  HM: '672',
  HN: '504',  HR: '385',  HT: '509',  HU: '36',   ID: '62',   IE: '353',
  IL: '972',  IM: '44',   IN: '91',   IO: '246',  IQ: '964',  IR: '98',
  IS: '354',  IT: '39',   JE: '44',   JM: '1876', JO: '962',  JP: '81',
  KE: '254',  KG: '996',  KH: '855',  KI: '686',  KM: '269',  KN: '1869',
  KP: '850',  KR: '82',   KW: '965',  KY: '1345', KZ: '7',    LA: '856',
  LB: '961',  LC: '1758', LI: '423',  LK: '94',   LR: '231',  LS: '266',
  LT: '370',  LU: '352',  LV: '371',  LY: '218',  MA: '212',  MC: '377',
  MD: '373',  ME: '382',  MF: '590',  MG: '261',  MH: '692',  MK: '389',
  ML: '223',  MM: '95',   MN: '976',  MO: '853',  MP: '1670', MQ: '596',
  MR: '222',  MS: '1664', MT: '356',  MU: '230',  MV: '960',  MW: '265',
  MX: '52',   MY: '60',   MZ: '258',  NA: '264',  NC: '687',  NE: '227',
  NF: '672',  NG: '234',  NI: '505',  NL: '31',   NO: '47',   NP: '977',
  NR: '674',  NU: '683',  NZ: '64',   OM: '968',  PA: '507',  PE: '51',
  PF: '689',  PG: '675',  PH: '63',   PK: '92',   PL: '48',   PM: '508',
  PN: '64',   PR: '1787', PS: '970',  PT: '351',  PW: '680',  PY: '595',
  QA: '974',  RE: '262',  RO: '40',   RS: '381',  RU: '7',    RW: '250',
  SA: '966',  SB: '677',  SC: '248',  SD: '249',  SE: '46',   SG: '65',
  SH: '290',  SI: '386',  SJ: '47',   SK: '421',  SL: '232',  SM: '378',
  SN: '221',  SO: '252',  SR: '597',  SS: '211',  ST: '239',  SV: '503',
  SX: '1721', SY: '963',  SZ: '268',  TC: '1649', TD: '235',  TF: '262',
  TG: '228',  TH: '66',   TJ: '992',  TK: '690',  TL: '670',  TM: '993',
  TN: '216',  TO: '676',  TR: '90',   TT: '1868', TV: '688',  TW: '886',
  TZ: '255',  UA: '380',  UG: '256',  UM: '1',    US: '1',    UY: '598',
  UZ: '998',  VA: '39',   VC: '1784', VE: '58',   VG: '1284', VI: '1340',
  VN: '84',   VU: '678',  WF: '681',  WS: '685',  YE: '967',  YT: '262',
  ZA: '27',   ZM: '260',  ZW: '263',
};

/** Dialling code for an alpha-2 country, WITHOUT '+'. Null if unknown. */
export function getDialCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return DIAL_CODES[code.toUpperCase()] ?? null;
}

// Reverse direction, for hydrating an existing stored number back into
// (country, national) parts. Shared codes resolve to the country listed here;
// everything else falls out of DIAL_CODES in declaration order.
//
// KNOWN LIMITATION — accepted, do not "fix" without changing the storage shape.
// Calling codes are many-to-one, so a country cannot be recovered from a number
// alone: +1 is 25 countries, +44 is four, +7 is two. A Canadian number reopened
// in an edit form therefore shows the US flag, and a Jersey number shows the UK
// flag. What is NOT affected is the data: the E.164 string round-trips byte for
// byte (asserted for every country in src/lib/phone.test.ts), so only the flag
// glyph is approximate. Recovering the true country would mean storing it
// separately alongside the number — a schema change and a backfill across every
// phone field on the platform, to correct a cosmetic detail. Not worth it.
const CANONICAL_FOR_SHARED_CODE: Readonly<Record<string, string>> = {
  '1':   'US',
  '7':   'RU',
  '39':  'IT',
  '44':  'GB',
  '47':  'NO',
  '61':  'AU',
  '64':  'NZ',
  '212': 'MA',
  '262': 'RE',
  '358': 'FI',
  '500': 'FK',
  '590': 'GP',
  '599': 'CW',
  '672': 'AQ',
};

const BY_DIAL_CODE: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [iso2, dial] of Object.entries(DIAL_CODES)) {
    if (!m.has(dial)) m.set(dial, iso2);
  }
  for (const [dial, iso2] of Object.entries(CANONICAL_FOR_SHARED_CODE)) {
    m.set(dial, iso2);
  }
  return m;
})();

/** Canonical alpha-2 country for a dialling code (no '+'). Null if unknown. */
export function dialCodeToCountry(dial: string): string | null {
  return BY_DIAL_CODE.get(dial) ?? null;
}

export interface SearchableDialCode extends SearchableCountry {
  /** Calling code WITHOUT '+', e.g. "64". */
  dial: string;
}

// Catalogue for the PhoneInput's country dropdown. Same shape as
// getSearchableCountries() plus the dial code, and `searchText` also matches on
// "+64" / "64" so typing the code finds the country.
export function getSearchableDialCodes(locale: 'en' | 'fa'): SearchableDialCode[] {
  return getSearchableCountries(locale)
    .map((c) => {
      const dial = DIAL_CODES[c.code];
      return dial ? { ...c, dial, searchText: `${c.searchText} +${dial} ${dial}` } : null;
    })
    .filter((c): c is SearchableDialCode => c !== null);
}

/**
 * Tolerant country-display formatter. Converts an ISO 3166-1 alpha-2 code
 * to its localized full name. Designed to be safe across all display sites
 * including those that may receive legacy free-text or null values.
 *
 * - null / undefined / '' → null (caller can render '—' or skip)
 * - 'OVERSEAS' sentinel  → 'Other / overseas country'
 * - 'IR'                 → 'Islamic Republic of Iran' (or localized)
 * - Unknown value        → returns input unchanged (fail-soft, e.g. 'Atlantis' stays 'Atlantis')
 */
export function displayCountry(
  code: string | null | undefined,
  locale: 'en' | 'fa' = 'en',
): string | null {
  if (code === null || code === undefined || code === '') return null;
  if (code === 'OVERSEAS') return locale === 'fa' ? 'دیگر / کشور خارجی' : 'Other / overseas country';
  return getCountryName(code, locale);
}
