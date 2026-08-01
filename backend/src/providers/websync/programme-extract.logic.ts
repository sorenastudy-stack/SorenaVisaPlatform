// PR-CATALOG-2 — pure extraction logic for the monthly web re-sync (Pass B, new-
// programme discovery). NO I/O here: the Claude call lives in ProgrammeExtractionService
// and the raw text is fed through these deterministic functions, so the whole mapping is
// golden-testable without a live API.
//
// The one design idea worth stating: we map the AI's output onto the SAME spreadsheet
// column keys the Excel importer uses, then run it through the importer's own
// `rowToProgrammeData` / `studyFieldKey` / `parseIntakes`. A web-discovered programme and
// an Excel-imported programme therefore normalise identically — one code path, no drift.
import { s, rowToProgrammeData, studyFieldKey, parseIntakes } from '../import/programme-import.logic';

// What we ask Claude to return per programme page. Everything optional — the extractor is
// told to use null for anything it can't find on the page rather than guess.
export interface ExtractedProgramme {
  name?: string | null;
  qualificationType?: string | null; // "Bachelor's Degree", "New Zealand Certificate", …
  nzqfLevel?: number | string | null; // 3..10
  subjectArea?: string | null; // → StudyField
  duration?: string | null; // raw, e.g. "1 year"
  deliveryMode?: string | null;
  campusCity?: string | null;
  tuitionFeeNZD?: number | string | null;
  feeBasis?: string | null;
  feeYear?: number | string | null;
  studentVisaSuitable?: boolean | string | null;
  intakes?: string | null; // raw comma/semicolon list
  confidence?: number | null; // AI self-assessed 0..1
  isProgramme?: boolean | null; // AI's judgment: is this actually a distinct programme page?
}

export interface ExtractCtx {
  providerId: string;
  sourceUrl: string;
}

export interface NormalizedCandidate {
  proposedData: {
    programme: ReturnType<typeof rowToProgrammeData> & {
      source: 'AUTOMATED_WEB_CHECK';
      sourceRef: string;
    };
    studyFieldKey: string;
    studyFieldUnmapped: boolean;
    intakes: ReturnType<typeof parseIntakes>;
  };
  nameNormalized: string;
  nzqfLevel: string | null;
  campusCity: string | null;
  detectedFields: string[];
  confidence: number; // EFFECTIVE — AI's claim capped by real field coverage
  meetsThreshold: boolean;
}

// Core fields (besides name) whose presence indicates a real, reviewable programme page.
// Coverage over these caps the AI's self-assessed confidence, so a page where only the
// name was found can never reach the main queue no matter how confident the model claims.
export const CORE_FIELDS = [
  'qualificationType',
  'nzqfLevel',
  'subjectArea',
  'tuitionFeeNZD',
  'duration',
  'campusCity',
] as const;

export const CONFIDENCE_THRESHOLD = 0.6;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// Deterministic dedupe key — must match how a stored programme's name would normalise, so
// a candidate we already have (or already rejected) is recognised and not re-surfaced.
export const normalizeName = (n: string): string =>
  n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

// AI field object → the importer's spreadsheet-column-keyed row.
export function extractedToRow(e: ExtractedProgramme): Record<string, unknown> {
  return {
    'Programme/Qualification': e.name ?? null,
    'Major/Strand': null,
    'Qualification Type': e.qualificationType ?? null,
    'NZQF Level': e.nzqfLevel ?? null,
    Duration: e.duration ?? null,
    Delivery: e.deliveryMode ?? null,
    'Student Visa Suitable': e.studentVisaSuitable ?? null,
    'Campus/City': e.campusCity ?? null,
    'Tuition Fee (NZD)': e.tuitionFeeNZD ?? null,
    'Fee Basis': e.feeBasis ?? null,
    'Fee Year': e.feeYear ?? null,
    '2027 Fee Status': null,
    'Scholarship/Study Grant': null,
    'Programme URL': null, // set from ctx.sourceUrl in normalizeCandidate
    'Secondary Verification Source': null,
    'Verified Date': null,
    'Verification Status': null,
    Notes: null,
  };
}

// One extracted object → a normalized candidate, or null when it isn't a reviewable
// programme at all (no name, or the AI flagged the page as a non-programme).
export function normalizeCandidate(
  e: ExtractedProgramme,
  ctx: ExtractCtx,
): NormalizedCandidate | null {
  const name = s(e.name);
  if (!name) return null; // no name → not a candidate
  if (e.isProgramme === false) return null; // AI says this page isn't a programme

  const row = extractedToRow(e);
  row['Programme URL'] = ctx.sourceUrl;
  const base = rowToProgrammeData(row, ctx.providerId);
  const programme = { ...base, source: 'AUTOMATED_WEB_CHECK' as const, sourceRef: ctx.sourceUrl };

  const sf = studyFieldKey(s(e.subjectArea), name);
  const intakes = parseIntakes(s(e.intakes), null, null);

  const detected = CORE_FIELDS.filter((f) => s((e as Record<string, unknown>)[f]) != null);
  const coverage = detected.length / CORE_FIELDS.length;
  const aiConfidence = clamp01(typeof e.confidence === 'number' ? e.confidence : 0.5);
  const confidence = round2(Math.min(aiConfidence, coverage)); // real coverage caps the claim

  return {
    proposedData: { programme, studyFieldKey: sf.key, studyFieldUnmapped: sf.unmapped, intakes },
    nameNormalized: normalizeName(name),
    nzqfLevel: programme.nzqfLevel ?? null,
    campusCity: programme.campusCity ?? null,
    detectedFields: ['name', ...detected],
    confidence,
    meetsThreshold: confidence >= CONFIDENCE_THRESHOLD,
  };
}

const stripFences = (raw: string): string =>
  raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

// Tolerant parse of the model's reply → 0..N extracted objects. Accepts a bare object, a
// bare array, a ```json fenced block, or a { "programmes": [...] } wrapper; returns [] on
// anything unparseable rather than throwing (a bad page must not abort the sweep).
export function parseExtractionResponse(raw: string): ExtractedProgramme[] {
  const text = stripFences((raw ?? '').trim()).trim();
  if (!text) return [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (!m) return [];
    try {
      json = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { programmes?: unknown }).programmes)
      ? (json as { programmes: unknown[] }).programmes
      : [json];
  return arr.filter((x): x is ExtractedProgramme => !!x && typeof x === 'object');
}

// Pure prompt builder (kept here so the wording is version-controlled with the schema it
// depends on). The service just wires this to ClaudeService.extractJson.
export function buildExtractionPrompt(pageText: string): { system: string; user: string } {
  const system = [
    'You extract structured data about tertiary education programmes from a single web page of a New Zealand education provider.',
    'Return ONLY JSON — an array of programme objects (usually one; more only if the page genuinely describes several distinct programmes).',
    'Each object may include: name, qualificationType, nzqfLevel (integer 3-10), subjectArea, duration, deliveryMode, campusCity, tuitionFeeNZD (number), feeBasis, feeYear, studentVisaSuitable (boolean), intakes (comma-separated), confidence (0..1), isProgramme (boolean).',
    'Use null for any field you cannot find on the page. NEVER guess or invent values — fabricated fees or levels are worse than nulls.',
    'Set isProgramme=false if the page is a listing, news, marketing, or otherwise not a specific programme. Set confidence to your genuine certainty that this is one real, currently-offered programme with the details you extracted.',
  ].join('\n');
  const user = `Extract the programme(s) from this page. Return JSON only.\n\n${pageText}`;
  return { system, user };
}
