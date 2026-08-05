// PR-EXPLORE (Round 3) — parsing primitives SHARED by the scholarship and tuition
// spreadsheet importers. Both are the same shape of problem: a per-institution sheet,
// grouped by country, with varying column names, uploaded by a non-technical user.
// One implementation means a country spelling fixed for one importer is fixed for both.
//
// Pure: NO DB, NO I/O except the lazy XLSX read.

let _xlsx: any;
const XLSX: any = new Proxy({}, { get: (_t, prop) => { _xlsx ??= require('xlsx'); return _xlsx[prop]; } });

// ─── Country detection ────────────────────────────────────────────────────────

const COUNTRY_ALIASES: Record<string, string> = {};
const register = (code: string, ...aliases: string[]) => {
  for (const a of aliases) COUNTRY_ALIASES[normaliseKey(a)] = code;
};

register('IR', 'iran', 'iranian', 'islamic republic of iran', 'iran islamic republic of', 'ir iran', 'persia');
register('IN', 'india', 'indian', 'republic of india');
register('CN', 'china', 'chinese', 'prc', 'peoples republic of china', 'china mainland', 'mainland china');
register('VN', 'vietnam', 'viet nam', 'vietnamese', 'socialist republic of vietnam');
register('PH', 'philippines', 'the philippines', 'filipino', 'philippine', 'republic of the philippines');
register('LK', 'sri lanka', 'sri lankan', 'srilanka', 'ceylon');
register('NP', 'nepal', 'nepali', 'nepalese');
register('BD', 'bangladesh', 'bangladeshi');
register('PK', 'pakistan', 'pakistani');
register('TH', 'thailand', 'thai');
register('ID', 'indonesia', 'indonesian');
register('MY', 'malaysia', 'malaysian');
register('JP', 'japan', 'japanese');
register('KR', 'south korea', 'korea south', 'republic of korea', 'korea', 'korean');
register('TW', 'taiwan', 'taiwanese', 'chinese taipei');
register('HK', 'hong kong', 'hongkong', 'hong kong sar');
register('BR', 'brazil', 'brazilian');
register('CO', 'colombia', 'colombian');
register('CL', 'chile', 'chilean');
register('RU', 'russia', 'russian', 'russian federation');
register('TR', 'turkey', 'turkish', 'turkiye', 'türkiye');
register('SA', 'saudi arabia', 'saudi', 'saudi arabian', 'kingdom of saudi arabia', 'ksa');
register('AE', 'united arab emirates', 'uae', 'emirati', 'u a e');
register('EG', 'egypt', 'egyptian');
register('NG', 'nigeria', 'nigerian');
register('KE', 'kenya', 'kenyan');
register('ZA', 'south africa', 'south african');
register('FJ', 'fiji', 'fijian');
register('WS', 'samoa', 'samoan');
register('TO', 'tonga', 'tongan');
register('GB', 'united kingdom', 'uk', 'britain', 'great britain', 'british');
register('US', 'united states', 'usa', 'us', 'united states of america', 'american');
register('AU', 'australia', 'australian');
register('NZ', 'new zealand', 'nz', 'new zealander', 'kiwi', 'domestic');
register('MM', 'myanmar', 'burma', 'burmese');
register('KH', 'cambodia', 'cambodian', 'khmer');
register('MN', 'mongolia', 'mongolian');
register('UZ', 'uzbekistan', 'uzbek');
register('IQ', 'iraq', 'iraqi');
register('AF', 'afghanistan', 'afghan');

/** Lowercase, strip accents/punctuation/parentheses, collapse whitespace. */
export function normaliseKey(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE =
  /\b(students?|nationals?|citizens?|applicants?|scholarships?|awards?|fees?|tuitions?|rates?|from|for|of|the|only|per|year)\b/g;

export interface CountryMatch {
  code: string | null;
  label: string;
  confidence: 'exact' | 'near' | 'none';
  suggestion?: string;
}

export function detectCountry(raw: unknown): CountryMatch {
  const label = String(raw ?? '').trim();
  const key = normaliseKey(raw);
  if (!key) return { code: null, label, confidence: 'none' };

  if (COUNTRY_ALIASES[key]) return { code: COUNTRY_ALIASES[key], label, confidence: 'exact' };

  const stripped = key.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (stripped && COUNTRY_ALIASES[stripped]) {
    return { code: COUNTRY_ALIASES[stripped], label, confidence: 'exact' };
  }

  for (const alias of Object.keys(COUNTRY_ALIASES)) {
    if (alias.length < 4) continue; // don't let "us"/"uk"/"nz" match inside words
    if (new RegExp(`(^|\\s)${alias}(\\s|$)`).test(stripped || key)) {
      return { code: COUNTRY_ALIASES[alias], label, confidence: 'exact' };
    }
  }

  const candidate = nearestAlias(stripped || key);
  if (candidate) return { code: null, label, confidence: 'near', suggestion: candidate };
  return { code: null, label, confidence: 'none' };
}

function nearestAlias(key: string): string | null {
  let best: { alias: string; d: number } | null = null;
  for (const alias of Object.keys(COUNTRY_ALIASES)) {
    if (Math.abs(alias.length - key.length) > 2) continue;
    const d = levenshtein(key, alias);
    if (d <= 2 && (!best || d < best.d)) best = { alias, d };
  }
  return best ? best.alias : null;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// ─── Cell / column helpers ────────────────────────────────────────────────────

export const txt = (v: unknown): string | null => {
  const t = v == null ? '' : String(v).trim();
  return t && t !== '-' && t.toLowerCase() !== 'n/a' ? t : null;
};

/**
 * Build a header→field mapper from per-importer hints.
 * Scores by LONGEST matching hint across ALL fields: "Award Value" contains both
 * name's "award" and amount's "award value", and the more specific hint must win.
 */
export function buildColumnMapper(hints: Record<string, string[]>) {
  return function mapColumns(headers: unknown[]): Record<string, number> {
    const found: Record<string, number> = {};
    headers.forEach((h, idx) => {
      const key = normaliseKey(h);
      if (!key) return;
      let best: { field: string; len: number } | null = null;
      for (const [field, list] of Object.entries(hints)) {
        if (field in found) continue;
        for (const hint of list) {
          if (key.includes(hint) && (!best || hint.length > best.len)) best = { field, len: hint.length };
        }
      }
      if (best) found[best.field] = idx;
    });
    return found;
  };
}

export type AmountType = 'FIXED' | 'PERCENTAGE';

/** "NZ$3,000" → 3000 FIXED; "20%" → 20 PERCENTAGE; "TBC" → null. */
export function parseAmount(
  amountCell: unknown,
  typeCell?: unknown,
): { amountType: AmountType; amountValue: number } | null {
  const raw = txt(amountCell);
  if (!raw) return null;
  const isPercent = /%|percent/i.test(raw) || /percent|%/i.test(String(typeCell ?? ''));
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (isPercent && (n <= 0 || n > 100)) return null;
  if (n < 0) return null;
  return { amountType: isPercent ? 'PERCENTAGE' : 'FIXED', amountValue: n };
}

// ─── Qualification level ──────────────────────────────────────────────────────
// Sheets say "Masters", "Master's", "Bachelors", "PG Dip"; the QualificationLevel
// enum says MASTER, BACHELOR, POSTGRADUATE_DIPLOMA. Passing raw sheet text to
// Prisma throws, so normalise here.
//
// FAIL CLOSED: a non-empty level we cannot map returns unmapped:true and the
// caller flags the row. Treating it as null ("applies to any level") would apply,
// say, a Foundation rate to a Master's student.

const LEVEL_ALIASES: Array<[RegExp, string]> = [
  [/^(phd|doctorate|doctoral)/, 'PHD'],
  [/^(master|masters|msc|ma|meng|mba)/, 'MASTER'],
  [/(postgraduate|post graduate|pg)\s*(dip|diploma)/, 'POSTGRADUATE_DIPLOMA'],
  [/(postgraduate|post graduate|pg)\s*(cert|certificate)/, 'POSTGRADUATE_CERTIFICATE'],
  [/(graduate|grad)\s*(dip|diploma)/, 'GRADUATE_DIPLOMA'],
  [/(graduate|grad)\s*(cert|certificate)/, 'GRADUATE_CERTIFICATE'],
  [/^(bachelor|bachelors|undergraduate|ug|bsc|ba|beng)/, 'BACHELOR'],
  [/^(diploma|dip)/, 'DIPLOMA'],
  [/^(certificate|cert)/, 'CERTIFICATE'],
];

export function normaliseLevel(v: unknown): { level: string | null; unmapped: boolean } {
  const t = txt(v);
  if (!t) return { level: null, unmapped: false }; // blank = applies to any level
  const key = normaliseKey(t);
  for (const [re, level] of LEVEL_ALIASES) {
    if (re.test(key)) return { level, unmapped: false };
  }
  return { level: null, unmapped: true };
}

/** A row is a country SECTION HEADER if exactly one cell is filled and names a country. */
export function isSectionHeader(cells: unknown[]): CountryMatch | null {
  const filled = cells.map(txt).filter((c): c is string => c !== null);
  if (filled.length !== 1) return null;
  const match = detectCountry(filled[0]);
  return match.confidence === 'exact' ? match : null;
}

/**
 * First worksheet → raw 2-D array.
 * blankrows:true is deliberate: dropping blanks would shift indices and the row
 * numbers we report would stop matching what the uploader sees in Excel.
 */
export function sheetToMatrix(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
}
