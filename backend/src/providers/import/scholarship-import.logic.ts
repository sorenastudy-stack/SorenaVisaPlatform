// PR-EXPLORE (Round 2) — pure parse logic for the per-university scholarship
// spreadsheet. Mirrors programme-import.logic.ts: NO DB access here, the service
// does the upserts, so this file is unit-testable and the CLI/Owner-panel share
// one code path.
//
// `xlsx` (SheetJS) is loaded LAZILY for the same reason as programme-import.logic.ts —
// a production install can legitimately lack it, and a top-level import would crash
// app boot for everyone rather than just disabling the optional import feature.
let _xlsx: any;
const XLSX: any = new Proxy({}, { get: (_t, prop) => { _xlsx ??= require('xlsx'); return _xlsx[prop]; } });

// Design constraints (Owner, Round 2):
//   • Yashua uploads one sheet per university per year/term. He is NOT technical.
//   • Sheets are grouped BY COUNTRY — either a "Country" column, or country
//     section-header rows with the scholarships for that country beneath.
//   • Country names must be detected FROM THE SHEET — no manual code mapping step.
//   • Formats vary university-to-university → be forgiving about column naming/order.
//   • NEVER silently skip or guess wrong. Anything not confidently parsed is
//     returned in `needsReview` for a human, with the row number and the raw text.

export type ScholarshipAmountType = 'FIXED' | 'PERCENTAGE';

export interface ParsedScholarship {
  countryCode: string; // ISO 3166-1 alpha-2 → ProviderScholarship.nationality
  countryLabel: string; // what the sheet actually said, for the report
  name: string;
  amountType: ScholarshipAmountType;
  amountValue: number;
  currency: string;
  level: string | null;
  eligibilityNotes: string | null;
  sourceRow: number; // 1-based sheet row, so the UI can point at it
}

export type ReviewReason =
  | 'UNRECOGNISED_COUNTRY'
  | 'NO_COUNTRY_CONTEXT'
  | 'MISSING_NAME'
  | 'MISSING_OR_INVALID_AMOUNT';

export interface ReviewItem {
  sourceRow: number;
  reason: ReviewReason;
  raw: string; // the offending cell text, verbatim
  suggestion?: string; // e.g. a near-miss country match — NEVER auto-applied
}

export interface CountryTally {
  countryCode: string;
  countryLabel: string;
  count: number;
}

export interface ScholarshipImportPreview {
  rows: ParsedScholarship[];
  detected: CountryTally[];
  needsReview: ReviewItem[];
  /** Rows that were blank or were consumed as section headers — not errors. */
  skippedRows: number;
}

// ─── Country detection ────────────────────────────────────────────────────────
// Alias → ISO2. Covers official names, common short forms, and the ADJECTIVAL
// forms real spreadsheets use ("Iranian students", "Chinese"). Deliberately a
// curated table rather than a fuzzy-only match: a wrong country silently assigned
// to a scholarship is worse than asking a human.

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
register('NZ', 'new zealand', 'nz', 'new zealander', 'kiwi');
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

/** Words that appear alongside a country name and should not block a match. */
const NOISE = /\b(students?|nationals?|citizens?|applicants?|scholarships?|awards?|from|for|of|the|only)\b/g;

export interface CountryMatch {
  code: string | null;
  label: string;
  /** exact = trusted; near = a suggestion for a human, never auto-applied. */
  confidence: 'exact' | 'near' | 'none';
  suggestion?: string;
}

/**
 * Detect a country from arbitrary sheet text ("Iran", "Iranian Students",
 * "Students from Sri Lanka", "IRAN (Islamic Republic of)").
 */
export function detectCountry(raw: unknown): CountryMatch {
  const label = String(raw ?? '').trim();
  const key = normaliseKey(raw);
  if (!key) return { code: null, label, confidence: 'none' };

  if (COUNTRY_ALIASES[key]) return { code: COUNTRY_ALIASES[key], label, confidence: 'exact' };

  // Strip filler words ("Iranian Students" → "iranian") and retry.
  const stripped = key.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (stripped && COUNTRY_ALIASES[stripped]) {
    return { code: COUNTRY_ALIASES[stripped], label, confidence: 'exact' };
  }

  // A known alias appearing as a whole phrase inside longer text.
  for (const alias of Object.keys(COUNTRY_ALIASES)) {
    if (alias.length < 4) continue; // don't let "us"/"uk"/"nz" match inside words
    if (new RegExp(`(^|\\s)${alias}(\\s|$)`).test(stripped || key)) {
      return { code: COUNTRY_ALIASES[alias], label, confidence: 'exact' };
    }
  }

  // Near-miss (typo) → SUGGEST for review, never auto-apply.
  const candidate = nearestAlias(stripped || key);
  if (candidate) {
    return { code: null, label, confidence: 'near', suggestion: candidate };
  }
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

// ─── Column detection ─────────────────────────────────────────────────────────
// Header names vary per university, so match on substrings rather than exact keys.

const COLUMN_HINTS: Record<string, string[]> = {
  country: ['country', 'nationality', 'citizenship', 'region', 'nation'],
  name: ['scholarship name', 'award name', 'scholarship', 'award', 'name', 'title', 'description'],
  amount: ['amount', 'value', 'scholarship value', 'award value', 'nzd', 'fee reduction', 'discount'],
  type: ['type', 'amount type', 'basis'],
  level: ['level', 'qualification', 'study level', 'programme level', 'program level'],
  notes: ['eligibility', 'criteria', 'conditions', 'notes', 'requirements', 'comment'],
};

/**
 * Map a sheet's header row to our canonical field names.
 *
 * Scores by LONGEST matching hint across ALL fields, not first-field-wins:
 * "Award Value" contains both name's "award" and amount's "award value", and the
 * longer, more specific hint must win or the amount column is lost entirely.
 */
export function mapColumns(headers: unknown[]): Record<string, number> {
  const found: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const key = normaliseKey(h);
    if (!key) return;
    let best: { field: string; len: number } | null = null;
    for (const [field, hints] of Object.entries(COLUMN_HINTS)) {
      if (field in found) continue; // first column to claim a field keeps it
      for (const hint of hints) {
        if (key.includes(hint) && (!best || hint.length > best.len)) {
          best = { field, len: hint.length };
        }
      }
    }
    if (best) found[best.field] = idx;
  });
  return found;
}

// ─── Value coercion ───────────────────────────────────────────────────────────

const txt = (v: unknown): string | null => {
  const t = v == null ? '' : String(v).trim();
  return t && t !== '-' && t.toLowerCase() !== 'n/a' ? t : null;
};

/** "NZ$3,000" → 3000 FIXED; "20%" → 20 PERCENTAGE; "up to 5000" → 5000 FIXED. */
export function parseAmount(
  amountCell: unknown,
  typeCell?: unknown,
): { amountType: ScholarshipAmountType; amountValue: number } | null {
  const raw = txt(amountCell);
  if (!raw) return null;
  const isPercent = /%|percent/i.test(raw) || /percent|%/i.test(String(typeCell ?? ''));
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (isPercent && (n <= 0 || n > 100)) return null; // a nonsense percentage is a review item
  if (n < 0) return null;
  return { amountType: isPercent ? 'PERCENTAGE' : 'FIXED', amountValue: n };
}

/** A row is a country SECTION HEADER if exactly one cell is filled and it names a country. */
export function isSectionHeader(cells: unknown[]): CountryMatch | null {
  const filled = cells.map(txt).filter((c): c is string => c !== null);
  if (filled.length !== 1) return null;
  const match = detectCountry(filled[0]);
  return match.confidence === 'exact' ? match : null;
}

// ─── Main parse ───────────────────────────────────────────────────────────────

/**
 * Read the first worksheet into a raw 2-D array (header:1 → no key guessing).
 *
 * blankrows:true is deliberate — dropping blank rows would shift every index and
 * the row numbers we report ("check row 9") would no longer match what Yashua
 * sees in Excel, which is the whole point of reporting them.
 */
export function sheetToMatrix(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
}

/**
 * Parse a scholarship matrix into upsert-ready rows.
 * Handles BOTH layouts: a per-row Country column, and country section headers.
 */
export function parseScholarshipMatrix(matrix: unknown[][], currency = 'NZD'): ScholarshipImportPreview {
  const rows: ParsedScholarship[] = [];
  const needsReview: ReviewItem[] = [];
  let skippedRows = 0;

  // Find the header row: the first row that maps at least a name and an amount.
  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const c = mapColumns(matrix[i] ?? []);
    if ('name' in c && 'amount' in c) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      rows: [],
      detected: [],
      needsReview: [{ sourceRow: 1, reason: 'MISSING_NAME', raw: 'No header row with a name + amount column was found.' }],
      skippedRows: matrix.length,
    };
  }

  let sectionCountry: CountryMatch | null = null;

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const sourceRow = i + 1; // 1-based for humans
    if (cells.every((c) => txt(c) === null)) {
      skippedRows++;
      continue;
    }

    // A lone filled cell is a structural row (a country section header, or a note).
    // CRITICAL: it ALWAYS ends the current section, even when we cannot resolve it.
    // Otherwise a typo'd header like "Vietnnam" leaves the previous section active
    // and every row beneath it is silently filed under the WRONG country — the exact
    // guess-wrong-silently failure this importer must never commit.
    const lone = cells.map(txt).filter((c): c is string => c !== null);
    if (lone.length === 1) {
      const match = detectCountry(lone[0]);
      skippedRows++;
      if (match.confidence === 'exact') {
        sectionCountry = match; // start a new section
      } else {
        sectionCountry = null; // fail closed — no inherited country
        if (match.confidence === 'near') {
          needsReview.push({
            sourceRow,
            reason: 'UNRECOGNISED_COUNTRY',
            raw: match.label,
            suggestion: match.suggestion,
          });
        }
        // confidence 'none' → an ordinary note/title row; nothing to report.
      }
      continue;
    }

    // Resolve the country: explicit column wins, else the current section.
    let country: CountryMatch | null = null;
    if ('country' in cols && txt(cells[cols.country])) {
      country = detectCountry(cells[cols.country]);
    } else if (sectionCountry) {
      country = sectionCountry;
    }

    const name = txt(cells[cols.name]);
    const amount = parseAmount(cells[cols.amount], 'type' in cols ? cells[cols.type] : undefined);

    if (!country || country.confidence === 'none') {
      needsReview.push({
        sourceRow,
        reason: country ? 'UNRECOGNISED_COUNTRY' : 'NO_COUNTRY_CONTEXT',
        raw: country?.label || name || '(blank)',
      });
      continue;
    }
    if (country.confidence === 'near' || !country.code) {
      needsReview.push({
        sourceRow,
        reason: 'UNRECOGNISED_COUNTRY',
        raw: country.label,
        suggestion: country.suggestion,
      });
      continue;
    }
    if (!name) {
      needsReview.push({ sourceRow, reason: 'MISSING_NAME', raw: String(cells[cols.name] ?? '(blank)') });
      continue;
    }
    if (!amount) {
      needsReview.push({
        sourceRow,
        reason: 'MISSING_OR_INVALID_AMOUNT',
        raw: String(cells[cols.amount] ?? '(blank)'),
      });
      continue;
    }

    rows.push({
      countryCode: country.code,
      countryLabel: country.label,
      name,
      amountType: amount.amountType,
      amountValue: amount.amountValue,
      currency,
      level: 'level' in cols ? txt(cells[cols.level]) : null,
      eligibilityNotes: 'notes' in cols ? txt(cells[cols.notes]) : null,
      sourceRow,
    });
  }

  // Tally per country for the "what did it find" report.
  const tally = new Map<string, CountryTally>();
  for (const r of rows) {
    const t = tally.get(r.countryCode);
    if (t) t.count++;
    else tally.set(r.countryCode, { countryCode: r.countryCode, countryLabel: r.countryLabel, count: 1 });
  }

  return {
    rows,
    detected: [...tally.values()].sort((a, b) => b.count - a.count || a.countryCode.localeCompare(b.countryCode)),
    needsReview,
    skippedRows,
  };
}

/** Convenience: buffer → preview. The service calls this, then upserts `rows`. */
export function parseScholarshipWorkbook(buffer: Buffer, currency = 'NZD'): ScholarshipImportPreview {
  return parseScholarshipMatrix(sheetToMatrix(buffer), currency);
}
