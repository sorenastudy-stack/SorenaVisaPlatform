// PR-IMPORT — pure parse logic for the three NZ source catalogues (ITP / PTE /
// University). NO DB access: the service does the upserts, so this file is unit
// testable and the CLI + Owner-panel upload share one code path.
//
// Layout confirmed by direct inspection of all three workbooks:
//   sheet   : "Programme Database"
//   rows 1-3: title + scope note + a blank spacer  → skipped
//   row  4  : the real header
//   row  5+ : one row per programme
// The blank spacer at row 3 matters — reading with blankrows:false silently shifts
// every index by one and makes the header look like a data row.
//
// SUBJECT AREA IS NOT RE-BUCKETED. Each institution's own label is carried through
// verbatim; the curation tabs are just the distinct values that institution's rows
// contain. A blank label becomes the literal "Unspecified" so those rows stay
// visible and editable rather than disappearing from every tab.

let _xlsx: any;
const XLSX: any = new Proxy({}, { get: (_t, p) => { _xlsx ??= require('xlsx'); return _xlsx[p]; } });

export type SourceFile = 'ITP' | 'PTE' | 'University';

export const UNSPECIFIED_SUBJECT_AREA = 'Unspecified';

export interface ParsedProgrammeRow {
  sourceFile: SourceFile;
  sourceRow: number; // 1-based row in the sheet, for human-readable reporting
  institutionName: string; // Provider Entity | University
  brand: string | null; // ITP/PTE only
  subjectAreaRaw: string; // never empty — blank becomes UNSPECIFIED_SUBJECT_AREA
  programmeName: string;
  majorStrand: string | null;
  nzqfLevel: number | null;
  qualificationType: string | null;
  delivery: string | null;
  studentVisaSuitable: string | null;
  campusCity: string | null;
  duration: string | null;
  remaining2026Intakes: string | null;
  published2027Intakes: string | null;
  /** Verbatim source text — ALWAYS retained, even when a clean amount is parsed. */
  tuitionFeeRaw: string | null;
  /** Populated ONLY when the source states one unambiguous figure. */
  tuitionFeeNZD: number | null;
  /** Why a fee could not be reduced to one number (conditional/ranged/absent). */
  tuitionParseNote: string | null;
  feeBasis: string | null;
  feeYear: number | null;
  fee2027Status: string | null;
  academicPrerequisites: string | null;
  englishRequirement: string | null;
  otherRequirements: string | null;
  scholarshipNote: string | null;
  programmeUrl: string | null;
  verificationSourceUrl: string | null;
  verifiedDate: string | null;
  verificationStatus: string | null;
  notes: string | null;
  // ITP only
  projected2027Intakes: string | null;
  intakeBasis2027: string | null;
  intakes2027ForPlanning: string | null;
}

export interface WorkbookParseResult {
  sourceFile: SourceFile;
  rows: ParsedProgrammeRow[];
  institutions: string[]; // distinct, in first-seen order
  problems: Array<{ sourceRow: number; issue: string; raw: string }>;
  /** Rows intentionally skipped this pass — see DEFERRED_ROWS. Reported, never silent. */
  deferred: Array<{ sourceRow: number; institutionName: string; programmeName: string }>;
}

const HEADER_ROW_INDEX = 3; // row 4, 0-based
const FIRST_DATA_ROW_INDEX = 4; // row 5

const txt = (v: unknown): string | null => {
  const t = v == null ? '' : String(v).trim();
  return t && t !== '-' && t.toLowerCase() !== 'n/a' ? t : null;
};

/** Institution-name column differs: universities have no separate legal-entity column. */
const INSTITUTION_HEADER: Record<SourceFile, string> = {
  ITP: 'Provider Entity',
  PTE: 'Provider Entity',
  University: 'University',
};

const SUBJECT_AREA_HEADER: Record<SourceFile, string> = {
  ITP: 'Subject Area',
  PTE: 'Subject Area',
  University: 'Subject Area (Faculty)',
};

/** Map header text → column index. Exact match on the trimmed header. */
export function headerIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const k = String(h ?? '').trim();
    if (k && !(k in map)) map[k] = i;
  });
  return map;
}

/**
 * Parse the "Tuition Fee (NZD)" free-text cell.
 *
 * The source is deliberately inconsistent: some rows carry one clean figure, others
 * are genuinely conditional ("$13,286 per 60 credits or $26,572 per 120 credits
 * (programme dependent)"). Forcing a conditional fee into a single number would
 * quote students a price the institution never stated, so those return amount:null
 * WITH the raw text preserved and a note explaining why.
 */
export function parseTuition(raw: unknown): { amount: number | null; note: string | null } {
  const t = txt(raw);
  if (!t) return { amount: null, note: 'no fee stated in source' };

  // The three workbooks state money three different ways:
  //   ITP         "$26,572 per year"
  //   PTE         "22,000 (plus 2,400 resource/admin fee)"   ← bare, no symbol
  //   University  "NZD 48,133 per year (approx.)"            ← NZD prefix
  // So a $-only match silently loses ~45% of the catalogue.
  //
  // A bare number is only treated as money when it is comma-grouped (26,572) or
  // has cents (47674.80). That deliberately excludes the other numerics that share
  // these cells — NZQF years (2026/2027), credit counts ("60 credits"), and point
  // values ("180-point programme") — none of which are comma-grouped.
  // With an explicit $ or NZD prefix a bare integer is unambiguous ("NZD 19000 per
  // year"), so any number is taken. Without a prefix, only comma-grouped or
  // decimal figures count — that is what separates a fee from the credit counts,
  // point values and years that share these cells.
  const MONEY = /(?:\$|NZD)\s*(\d[\d,]*(?:\.\d+)?)|(\d{1,3}(?:,\d{3})+(?:\.\d+)?)/gi;
  const figures = [...t.matchAll(MONEY)]
    .map((m) => parseFloat((m[1] ?? m[2] ?? '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);

  // Plausibility floor. NZ international tuition is thousands per year; the ITP file
  // contains a stray "$2" which is a source typo, not a price. Anything under $1,000
  // is reported rather than stored, so a nonsense figure can never reach a student.
  const IMPLAUSIBLE_BELOW = 1000;
  const plausible = figures.filter((n) => n >= IMPLAUSIBLE_BELOW);
  if (figures.length > 0 && plausible.length === 0) {
    return { amount: null, note: `implausible fee in source (< $${IMPLAUSIBLE_BELOW}) — see raw text` };
  }
  const distinct = [...new Set(plausible)];

  if (distinct.length === 0) return { amount: null, note: 'no numeric amount found' };
  if (distinct.length > 1) {
    return { amount: null, note: `conditional/ranged fee — ${distinct.length} figures in source` };
  }
  // One figure, but hedging language means it is not a flat price.
  if (/\bor\b|depend|approx|from\b|up to|range/i.test(t)) {
    return { amount: null, note: 'qualified fee (conditional wording) — see raw text' };
  }
  return { amount: distinct[0], note: null };
}

/**
 * Map the workbook's free-text "Verification Status" onto the VerificationStatus
 * enum.
 *
 * The source does not use tidy labels — it writes a sentence whose FIRST WORDS
 * carry the confidence, then explains itself:
 *
 *   "Verified (NZQF Level 9 confirmed on studyspy.ac.nz…)"
 *   "Double-checked: live programme page + official fee schedule"
 *   "Single-source (fee/IELTS from IDP only; Lincoln's own page did not render…)"
 *
 * The import previously collapsed ALL of these to VERIFIED with
 * `row.verificationStatus ? 'VERIFIED' : null`, which labelled 379 of 1,128
 * rows more confidently than their own source claims. "Single-source" means one
 * unconfirmed source and is exactly the signal someone needs before publishing
 * a fee to a student, so it maps to NEEDS_RECHECK.
 *
 * Unrecognised text also maps to NEEDS_RECHECK — fail toward "look at this",
 * never toward "trusted".
 */
export function parseVerificationStatus(raw: unknown): 'VERIFIED' | 'UNVERIFIED' | 'NEEDS_RECHECK' | null {
  const t = txt(raw)?.toLowerCase();
  if (!t) return null;
  if (t.startsWith('single-source') || t.startsWith('single source')) return 'NEEDS_RECHECK';
  if (t.startsWith('unverified')) return 'UNVERIFIED';
  if (t.startsWith('verified') || t.startsWith('double-checked') || t.startsWith('double checked')) return 'VERIFIED';
  return 'NEEDS_RECHECK';
}

/** "4" / "Level 7" / 7 → 7; anything outside NZQF 1-10 → null. */
export function parseNzqfLevel(raw: unknown): number | null {
  const t = txt(raw);
  if (!t) return null;
  const m = t.match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 10 ? n : null;
}

export function parseYear(raw: unknown): number | null {
  const t = txt(raw);
  if (!t) return null;
  const m = t.match(/(20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Read one workbook's "Programme Database" sheet into structured rows. */
export function parseCatalogueWorkbook(buffer: Buffer, sourceFile: SourceFile): WorkbookParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Programme Database'];
  if (!ws) {
    return { sourceFile, rows: [], institutions: [], deferred: [], problems: [{ sourceRow: 0, issue: 'no "Programme Database" sheet', raw: wb.SheetNames.join(', ') }] };
  }
  // blankrows:true is REQUIRED — row 3 is an intentional blank spacer and dropping
  // it shifts the header out of position.
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
  const headers = (matrix[HEADER_ROW_INDEX] ?? []).map((h) => String(h ?? '').trim());
  const col = headerIndex(headers);

  const instHeader = INSTITUTION_HEADER[sourceFile];
  const saHeader = SUBJECT_AREA_HEADER[sourceFile];
  const problems: WorkbookParseResult['problems'] = [];
  for (const required of [instHeader, saHeader, 'Programme / Qualification']) {
    if (!(required in col)) problems.push({ sourceRow: HEADER_ROW_INDEX + 1, issue: `missing expected column "${required}"`, raw: headers.join(' | ').slice(0, 160) });
  }
  if (problems.length) return { sourceFile, rows: [], institutions: [], deferred: [], problems };

  const get = (r: unknown[], header: string): string | null =>
    header in col ? txt(r[col[header]]) : null;

  const rows: ParsedProgrammeRow[] = [];
  const institutions: string[] = [];
  const deferred: Array<{ sourceRow: number; institutionName: string; programmeName: string }> = [];
  const seenInst = new Set<string>();

  for (let i = FIRST_DATA_ROW_INDEX; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || !r.some((c) => c !== null && String(c).trim() !== '')) continue;
    const sourceRow = i + 1;

    const institutionName = get(r, instHeader);
    const programmeName = get(r, 'Programme / Qualification');
    if (!institutionName) { problems.push({ sourceRow, issue: 'row has no institution name', raw: String(r[0] ?? '').slice(0, 80) }); continue; }
    if (!programmeName) { problems.push({ sourceRow, issue: 'row has no programme name', raw: institutionName }); continue; }

    // Deliberately deferred — see DEFERRED_ROWS. Skipped BEFORE the institution
    // is registered so a deferral cannot accidentally create an empty provider,
    // and counted so a run always reports what it chose not to import rather
    // than quietly dropping it.
    if (isDeferredRow(institutionName, programmeName, get(r, 'NZQF Level'))) {
      deferred.push({ sourceRow, institutionName, programmeName });
      continue;
    }

    if (!seenInst.has(institutionName)) { seenInst.add(institutionName); institutions.push(institutionName); }

    const tuitionRaw = get(r, 'Tuition Fee (NZD)');
    const tuition = parseTuition(tuitionRaw);

    rows.push({
      sourceFile,
      sourceRow,
      institutionName,
      brand: get(r, 'Brand'),
      subjectAreaRaw: get(r, saHeader) ?? UNSPECIFIED_SUBJECT_AREA,
      programmeName,
      majorStrand: get(r, 'Major / Strand'),
      nzqfLevel: parseNzqfLevel(r[col['NZQF Level']]),
      qualificationType: get(r, 'Qualification Type'),
      delivery: get(r, 'Delivery'),
      studentVisaSuitable: get(r, 'Student Visa Suitable'),
      campusCity: get(r, 'Campus / City'),
      duration: get(r, 'Duration'),
      remaining2026Intakes: get(r, 'Remaining 2026 Intake(s)'),
      published2027Intakes: get(r, 'Published 2027 Intake(s)'),
      tuitionFeeRaw: tuitionRaw,
      tuitionFeeNZD: tuition.amount,
      tuitionParseNote: tuition.note,
      feeBasis: get(r, 'Fee Basis'),
      feeYear: parseYear(r[col['Fee Year']]),
      fee2027Status: get(r, '2027 Fee Status'),
      academicPrerequisites: get(r, 'Academic / Subject Prerequisites'),
      englishRequirement: get(r, 'English Requirement'),
      otherRequirements: get(r, 'Other Requirements'),
      scholarshipNote: get(r, 'Scholarship / Study Grant'),
      programmeUrl: get(r, 'Programme URL'),
      verificationSourceUrl: get(r, 'Secondary Verification Source'),
      verifiedDate: get(r, 'Verified Date'),
      verificationStatus: get(r, 'Verification Status'),
      notes: get(r, 'Notes'),
      projected2027Intakes: get(r, 'Projected 2027 Intake(s)'),
      intakeBasis2027: get(r, '2027 Intake Basis'),
      intakes2027ForPlanning: get(r, '2027 Intake(s) for Planning'),
    });
  }

  return { sourceFile, rows, institutions, problems, deferred };
}

/** ITP → POLYTECHNIC, PTE → COLLEGE, University → UNIVERSITY (existing enum values). */
export function providerTypeFor(sourceFile: SourceFile): 'UNIVERSITY' | 'POLYTECHNIC' | 'COLLEGE' {
  return sourceFile === 'University' ? 'UNIVERSITY' : sourceFile === 'ITP' ? 'POLYTECHNIC' : 'COLLEGE';
}

/**
 * PR-IMPORT — institutions the platform ALREADY tracks under a different name.
 *
 * The importer matches an institution by exact normalised name. That is
 * deliberately strict, but it means a trailing acronym is enough to miss: the
 * workbook says "Southern Institute of Technology" while the platform has
 * "Southern Institute of Technology (SIT)". Without this map the import would
 * create a SECOND provider for an institution that already exists, leaving
 * programmes on the new row while any existing agreements and applications stay
 * on the old one.
 *
 * Keys are the workbook's name, values the platform's existing provider name,
 * both verbatim; `aliasedProviderName` normalises each side so punctuation and
 * casing cannot cause a miss. Every pair here was confirmed by hand against
 * production — this is an allow-list, not fuzzy matching, precisely so a
 * coincidental name overlap can never silently merge two real institutions.
 *
 * Deliberately NOT included:
 *   * "New Zealand Skills and Education College (NZSE)" vs the platform's
 *     "Future Skills" — superficially similar, different institutions.
 *   * "Manukau Institute of Technology and Unitec" — the workbook treats these
 *     as one combined institution, the platform tracks MIT and Unitec
 *     separately. Owner decision: let it create a new third provider rather
 *     than force its programmes onto either existing record.
 */
export const PROVIDER_NAME_ALIASES: Record<string, string> = {
  'Nelson Marlborough Institute of Technology': 'Nelson Marlborough Institute of Technology (NMIT)',
  'Southern Institute of Technology': 'Southern Institute of Technology (SIT)',
  'Waikato Institute of Technology': 'Waikato Institute of Technology (Wintec)',
  'Western Institute of Technology at Taranaki': 'Western Institute of Technology at Taranaki (WITT)',
  'Whitireia and WelTec Polytechnic': 'Whitireia and WelTec (Whitireia / WelTec)',
  'ICL Graduate Business School (ICL Education Limited)': 'ICL',
  // Added Aug 2026 with the updated PTE workbook. The platform has tracked
  // "Future Skills" since before the catalogue import (it had no rows in any of
  // the three original workbooks, verified by searching every sheet), so the
  // record exists but is empty. Without this alias the workbook's legal name
  // would create a SECOND institution beside the one already in use.
  // NZQA Provider ID 737209001.
  'Future Skills Academy Limited': 'Future Skills',
};

/**
 * Rows deliberately NOT imported on this pass.
 *
 * The updated PTE workbook (Aug 2026) does two things at once: it adds six
 * genuinely new programmes, AND it rewrites two existing Seafield rows —
 * renaming them from "… (Academic) Level 5" to "… (Academic)" with the level
 * moved into the strand, plus corrected intakes, fee year and an upgraded
 * verification status.
 *
 * The importer is create-if-absent and keys partly on programme NAME, so those
 * two would import as NEW programmes and sit alongside the originals: four rows
 * for two real courses, with the corrections stranded on the copies. Deferring
 * them keeps this pass purely additive.
 *
 * NOT forgotten — tracked as a follow-up in
 * docs/PHASE_EXPLORE_PROGRAMMES.md. Closing it properly means teaching the
 * importer to update an existing row, which is a real change and deserves its
 * own tested pass rather than being smuggled in beside two new institutions.
 */
export const DEFERRED_ROWS: Array<{ institution: string; programme: string; level: string }> = [
  { institution: 'Seafield School of English Limited', programme: 'New Zealand Certificate in English Language (Academic)', level: 'Level 4' },
  { institution: 'Seafield School of English Limited', programme: 'New Zealand Certificate in English Language (Academic)', level: 'Level 5' },
];

/** Is this row on the deferred list? Compared on normalised text, like the aliases. */
export function isDeferredRow(institutionName: string, programmeName: string, nzqfLevelRaw: unknown): boolean {
  const n = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const level = n(nzqfLevelRaw);
  return DEFERRED_ROWS.some((d) =>
    n(d.institution) === n(institutionName)
    && n(d.programme) === n(programmeName)
    // "Level 5" and a bare "5" both appear in these columns across the files.
    && (level === n(d.level) || level === n(d.level.replace(/\D/g, ''))),
  );
}

/** Shared with the import service so both sides normalise identically. */
export const normaliseProviderName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The existing provider name a workbook institution should attach to, or null
 * if it is a genuinely new institution. Matching is on the normalised form, so
 * "(ICL Education Limited)" and "ICL Education Limited" resolve alike.
 */
export function aliasedProviderName(workbookName: string): string | null {
  const want = normaliseProviderName(workbookName);
  for (const [from, to] of Object.entries(PROVIDER_NAME_ALIASES)) {
    if (normaliseProviderName(from) === want) return to;
  }
  return null;
}

/** The distinct subject-area tabs an institution would show, largest first. */
export function subjectAreasFor(rows: ParsedProgrammeRow[], institutionName: string): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.institutionName !== institutionName) continue;
    counts.set(r.subjectAreaRaw, (counts.get(r.subjectAreaRaw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
