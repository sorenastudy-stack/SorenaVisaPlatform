// PR-EXPLORE (Round 3) — pure parse logic for the per-university TUITION spreadsheet.
// Structurally identical to scholarship-import.logic.ts and sharing all of its
// parsing primitives via sheet-parse.logic.ts, because they are the same problem:
// a per-institution sheet, grouped by country, uploaded by a non-technical user.
//
// Difference from scholarships: tuition rows carry an effective feeYear/term and are
// resolved as ONE applicable figure (most specific wins), not summed.

import {
  buildColumnMapper,
  detectCountry,
  isSectionHeader,
  parseAmount,
  normaliseLevel,
  sheetToMatrix,
  txt,
  type CountryMatch,
} from './sheet-parse.logic';

export interface ParsedTuition {
  countryCode: string;
  countryLabel: string;
  amountValue: number;
  currency: string;
  /** Percentage tuition is meaningless — always FIXED. A % cell is a review item. */
  level: string | null;
  feeYear: number | null;
  term: string | null;
  notes: string | null;
  sourceRow: number;
}

export type TuitionReviewReason =
  | 'UNRECOGNISED_COUNTRY'
  | 'NO_COUNTRY_CONTEXT'
  | 'MISSING_OR_INVALID_AMOUNT'
  | 'PERCENTAGE_NOT_VALID_FOR_TUITION'
  | 'UNMAPPED_LEVEL';

export interface TuitionReviewItem {
  sourceRow: number;
  reason: TuitionReviewReason;
  raw: string;
  suggestion?: string;
}

export interface TuitionCountryTally {
  countryCode: string;
  countryLabel: string;
  count: number;
}

export interface TuitionImportPreview {
  rows: ParsedTuition[];
  detected: TuitionCountryTally[];
  needsReview: TuitionReviewItem[];
  skippedRows: number;
}

// Tuition sheets label the amount column differently from scholarship sheets
// ("Annual Fee", "Tuition per year", "International Fee"), so the hints differ —
// but the matching mechanism is the shared one.
const COLUMN_HINTS: Record<string, string[]> = {
  country: ['country', 'nationality', 'citizenship', 'region', 'nation', 'student type'],
  amount: [
    'tuition per year',
    'annual tuition',
    'international fee',
    'tuition fee',
    'annual fee',
    'yearly fee',
    'tuition',
    'fee',
    'amount',
    'rate',
    'cost',
    'price',
  ],
  level: ['level', 'qualification', 'study level', 'programme level', 'program level'],
  year: ['year', 'academic year', 'fee year', 'intake year'],
  term: ['term', 'semester', 'intake'],
  notes: ['notes', 'comment', 'conditions', 'remarks'],
};

export const mapTuitionColumns = buildColumnMapper(COLUMN_HINTS);

const intOrNull = (v: unknown): number | null => {
  const t = txt(v);
  if (!t) return null;
  const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse a tuition matrix. Handles BOTH layouts (country column per row, and country
 * section headers), exactly like the scholarship importer.
 */
export function parseTuitionMatrix(matrix: unknown[][], currency = 'NZD'): TuitionImportPreview {
  const rows: ParsedTuition[] = [];
  const needsReview: TuitionReviewItem[] = [];
  let skippedRows = 0;

  // Header row detection. Amount alone is NOT sufficient: a title row like
  // "University of Example — International Tuition 2027" contains "tuition" and
  // would be mistaken for the header, swallowing the real one. (The scholarship
  // importer avoids this by requiring name AND amount; tuition has no name column,
  // so require instead: at least 2 filled cells, and amount PLUS one other field.)
  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const row = matrix[i] ?? [];
    if (row.filter((c) => txt(c) !== null).length < 2) continue;
    const c = mapTuitionColumns(row);
    if ('amount' in c && Object.keys(c).length >= 2) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      rows: [],
      detected: [],
      needsReview: [
        { sourceRow: 1, reason: 'MISSING_OR_INVALID_AMOUNT', raw: 'No header row with a tuition/fee column was found.' },
      ],
      skippedRows: matrix.length,
    };
  }

  let sectionCountry: CountryMatch | null = null;

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const sourceRow = i + 1;
    if (cells.every((c) => txt(c) === null)) {
      skippedRows++;
      continue;
    }

    // A lone filled cell ALWAYS ends the current section, even when unresolvable —
    // otherwise a typo'd header silently files the rows beneath under the previous
    // country. Same fail-closed rule as the scholarship importer.
    const lone = cells.map(txt).filter((c): c is string => c !== null);
    if (lone.length === 1) {
      const match = detectCountry(lone[0]);
      skippedRows++;
      if (match.confidence === 'exact') {
        sectionCountry = match;
      } else {
        sectionCountry = null;
        if (match.confidence === 'near') {
          needsReview.push({
            sourceRow,
            reason: 'UNRECOGNISED_COUNTRY',
            raw: match.label,
            suggestion: match.suggestion,
          });
        }
      }
      continue;
    }

    let country: CountryMatch | null = null;
    if ('country' in cols && txt(cells[cols.country])) {
      country = detectCountry(cells[cols.country]);
    } else if (sectionCountry) {
      country = sectionCountry;
    }

    if (!country || country.confidence === 'none') {
      needsReview.push({
        sourceRow,
        reason: country ? 'UNRECOGNISED_COUNTRY' : 'NO_COUNTRY_CONTEXT',
        raw: country?.label || '(blank)',
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

    const amount = parseAmount(cells[cols.amount]);
    if (!amount) {
      needsReview.push({
        sourceRow,
        reason: 'MISSING_OR_INVALID_AMOUNT',
        raw: String(cells[cols.amount] ?? '(blank)'),
      });
      continue;
    }
    // A percentage is a valid scholarship but NOT a valid tuition figure — flag it
    // rather than storing "20" as a dollar amount.
    if (amount.amountType === 'PERCENTAGE') {
      needsReview.push({
        sourceRow,
        reason: 'PERCENTAGE_NOT_VALID_FOR_TUITION',
        raw: String(cells[cols.amount] ?? ''),
      });
      continue;
    }

    // Level must map onto the QualificationLevel enum. An unmappable non-empty
    // level is flagged, never silently widened to "any level".
    const lvl = 'level' in cols ? normaliseLevel(cells[cols.level]) : { level: null, unmapped: false };
    if (lvl.unmapped) {
      needsReview.push({
        sourceRow,
        reason: 'UNMAPPED_LEVEL',
        raw: String(cells[cols.level] ?? ''),
      });
      continue;
    }

    rows.push({
      countryCode: country.code,
      countryLabel: country.label,
      amountValue: amount.amountValue,
      currency,
      level: lvl.level,
      feeYear: 'year' in cols ? intOrNull(cells[cols.year]) : null,
      term: 'term' in cols ? txt(cells[cols.term]) : null,
      notes: 'notes' in cols ? txt(cells[cols.notes]) : null,
      sourceRow,
    });
  }

  const tally = new Map<string, TuitionCountryTally>();
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

export function parseTuitionWorkbook(buffer: Buffer, currency = 'NZD'): TuitionImportPreview {
  return parseTuitionMatrix(sheetToMatrix(buffer), currency);
}

export { isSectionHeader };
