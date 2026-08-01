// PR-CATALOG-2 — pure orchestration logic for the monthly sweep. Frozen + golden-tested
// before the DB/network orchestrator is wired. Three concerns live here, all deterministic:
//   1. diffMonitoredFields — Pass A change detection (fee/level/etc.), comparing ONLY fields
//      the extractor actually FOUND, so defaulted/absent values never fabricate a change.
//   2. natKey / dedupe — the natural key that recognises a candidate we already have or
//      already rejected, so discovery means "what's new" not "the whole catalogue again".
//   3. routeCandidates — the noise guards: confidence threshold + per-run cap, with the
//      overflow counted (never silently dropped).
import type { NormalizedCandidate } from './programme-extract.logic';
import { normalizeName } from './programme-extract.logic';

export type ChangedFields = Record<string, { from: unknown; to: unknown }>;

// The fields Pass A monitors on an already-approved programme. Each is only compared when
// the extractor reports it in detectedFields — so a page where the fee wasn't found does
// NOT propose "fee changed to null". `detect` is the extractor's field name; `field` is the
// stored EducationProgramme column.
const MONITORED: { detect: string; field: string }[] = [
  { detect: 'tuitionFeeNZD', field: 'tuitionFeeNZD' },
  { detect: 'nzqfLevel', field: 'nzqfLevel' },
  { detect: 'duration', field: 'durationMonths' },
  { detect: 'campusCity', field: 'campusCity' },
  { detect: 'qualificationType', field: 'qualificationType' },
];

const eq = (a: unknown, b: unknown): boolean => {
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a ?? '') === String(b ?? '');
};

export interface StoredProgrammeFields {
  tuitionFeeNZD?: number | null;
  nzqfLevel?: string | null;
  durationMonths?: number | null;
  campusCity?: string | null;
  qualificationType?: string | null;
}

// Diff a stored programme against a freshly-extracted candidate. Returns {} when nothing a
// monitored+detected field disagrees on — the common case, so most pages propose nothing.
export function diffMonitoredFields(
  stored: StoredProgrammeFields,
  cand: NormalizedCandidate,
): ChangedFields {
  const out: ChangedFields = {};
  const prog = cand.proposedData.programme as unknown as Record<string, unknown>;
  for (const m of MONITORED) {
    if (!cand.detectedFields.includes(m.detect)) continue; // only compare what was found
    const to = prog[m.field] ?? null;
    const from = (stored as Record<string, unknown>)[m.field] ?? null;
    if (!eq(from, to)) out[m.field] = { from, to };
  }
  return out;
}

// True when two change sets are the same field→to mapping (used to avoid re-writing an
// already-pending proposal that hasn't actually moved).
export function sameChange(a: ChangedFields, b: ChangedFields): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => eq(a[k]?.to, b[k]?.to));
}

// Prisma update payload from an approved change proposal: {field: to}.
export function changeProposalToUpdate(changed: ChangedFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, { to }] of Object.entries(changed)) out[field] = to;
  return out;
}

// Deterministic dedupe key. For a stored programme use fromStored(); for a candidate the
// key parts are already normalized on the object.
export const natKey = (nameNormalized: string, nzqfLevel: string | null, campusCity: string | null): string =>
  `${nameNormalized}|${nzqfLevel ?? ''}|${campusCity ?? ''}`;

export const storedNatKey = (name: string, nzqfLevel: string | null, campusCity: string | null): string =>
  natKey(normalizeName(name), nzqfLevel, campusCity);

export const candidateNatKey = (c: NormalizedCandidate): string =>
  natKey(c.nameNormalized, c.nzqfLevel, c.campusCity);

export interface RoutedCandidates {
  surfaced: NormalizedCandidate[]; // above threshold, up to cap → written to the main queue
  cappedCount: number; // above threshold but over the cap → counted, not written
  lowConfidenceCount: number; // below threshold → counted, not written (kept out of the queue)
}

// The noise guards. Above-threshold candidates are surfaced highest-confidence-first up to
// `cap`; the rest are counted so the run summary can report them (no silent truncation).
// Below-threshold candidates are kept OUT of the Owner's queue and only counted.
export function routeCandidates(cands: NormalizedCandidate[], cap: number): RoutedCandidates {
  const above = cands
    .filter((c) => c.meetsThreshold)
    .sort((a, b) => b.confidence - a.confidence);
  const belowCount = cands.length - above.length;
  return {
    surfaced: above.slice(0, cap),
    cappedCount: Math.max(0, above.length - cap),
    lowConfidenceCount: belowCount,
  };
}
