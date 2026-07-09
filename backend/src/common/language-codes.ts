// Phase 2a — ISO 639-1 language codes.
//
// Mirrors the `common/country-codes.ts` facade, but for the two-letter
// ISO 639-1 language codes stored on `User.languages` (staff, set via the
// /staff/team booking profile) and `Contact.preferredLanguage` (client).
// Both sides MUST share this format so consultant auto-assignment's
// language filter can compare them directly (lowercase, e.g. 'fa', 'en').
//
// No runtime dependency — the canonical ISO 639-1 set is small and stable,
// so it's inlined rather than pulling in a library.

// Canonical ISO 639-1 alpha-2 codes (lowercase). Source: ISO 639-1 standard.
export const ALL_LANGUAGE_CODES: readonly string[] = [
  'aa','ab','ae','af','ak','am','an','ar','as','av','ay','az',
  'ba','be','bg','bh','bi','bm','bn','bo','br','bs',
  'ca','ce','ch','co','cr','cs','cu','cv','cy',
  'da','de','dv','dz',
  'ee','el','en','eo','es','et','eu',
  'fa','ff','fi','fj','fo','fr','fy',
  'ga','gd','gl','gn','gu','gv',
  'ha','he','hi','ho','hr','ht','hu','hy','hz',
  'ia','id','ie','ig','ii','ik','io','is','it','iu',
  'ja','jv',
  'ka','kg','ki','kj','kk','kl','km','kn','ko','kr','ks','ku','kv','kw','ky',
  'la','lb','lg','li','ln','lo','lt','lu','lv',
  'mg','mh','mi','mk','ml','mn','mr','ms','mt','my',
  'na','nb','nd','ne','ng','nl','nn','no','nr','nv','ny',
  'oc','oj','om','or','os',
  'pa','pi','pl','ps','pt',
  'qu',
  'rm','rn','ro','ru','rw',
  'sa','sc','sd','se','sg','si','sk','sl','sm','sn','so','sq','sr','ss','st','su','sv','sw',
  'ta','te','tg','th','ti','tk','tl','tn','to','tr','ts','tt','tw','ty',
  'ug','uk','ur','uz',
  've','vi','vo',
  'wa','wo',
  'xh',
  'yi','yo',
  'za','zh','zu',
];

const VALID_SET = new Set(ALL_LANGUAGE_CODES);

// Server-side validator for the staff-languages DTO. Accepts only exactly-two-
// lowercase-letter codes that are in the ISO 639-1 set. Lowercase-only here
// (unlike country codes which are uppercase) because both staff `languages`
// and client `preferredLanguage` are stored lowercase for direct comparison.
export function isValidLanguageCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  if (code.length !== 2) return false;
  if (code !== code.toLowerCase()) return false;
  return VALID_SET.has(code);
}

// Normalise an arbitrary list into trimmed, lowercased, de-duplicated,
// still-valid ISO 639-1 codes. Invalid entries are dropped (the DTO validator
// rejects them before this is reached; this is defence-in-depth on write).
export function normalizeLanguageCodes(codes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of codes) {
    if (typeof raw !== 'string') continue;
    const c = raw.trim().toLowerCase();
    if (!isValidLanguageCode(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
