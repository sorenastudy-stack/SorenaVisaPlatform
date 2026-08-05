// PR-EXPLORE (Round 3) — THE integration point.
//
// Every time a student reaches programme selection (Explore page, recommendation
// list, Admission Agent), BOTH figures are resolved together, live, server-side,
// for that specific authenticated student's nationality:
//
//   • their TUITION      — the nationality-specific rate if one exists, else the
//                          programme's flat tuitionFeeNZD, with which one was used
//                          reported EXPLICITLY (never a silent fallback)
//   • their SCHOLARSHIP  — the SUM of every applicable ProviderScholarship row
//                          (Round 2 correction), delegated to scholarship-total.logic
//
// Two students of different nationalities looking at the same programme legitimately
// see different tuition, different scholarship, and therefore a different sort order.
// There is no generic figure anywhere in this file.
//
// Pure + deterministic: NO DB, NO I/O. The caller loads the candidate rows.

import {
  computeScholarshipTotal,
  type ScholarshipRow,
  type ScholarshipTotal,
} from './scholarship-total.logic';

export interface TuitionRow {
  id: string;
  nationality: string;
  programmeId: string | null; // null = provider-wide
  level: string | null; // null = any level
  amountValue: number;
  currency: string;
  feeYear: number | null;
  isActive: boolean;
}

export interface PricingContext {
  nationality: string; // the AUTHENTICATED student's nationality (ISO)
  programmeId: string;
  level: string | null;
  /** EducationProgramme.tuitionFeeNZD — the explicit default/fallback. */
  defaultTuitionNZD: number | null;
}

export type TuitionSource = 'NATIONALITY_SPECIFIC' | 'DEFAULT' | 'UNKNOWN';

export interface ResolvedTuition {
  amountNZD: number | null;
  source: TuitionSource;
  /** Which ProviderTuition row won, when source is NATIONALITY_SPECIFIC. */
  rowId: string | null;
  feeYear: number | null;
  /** Set when a nationality row existed but could not be used (e.g. foreign currency). */
  note: string | null;
}

export interface StudentPricing {
  tuition: ResolvedTuition;
  scholarship: ScholarshipTotal;
  /** tuition − scholarship, floored at 0. null when tuition is unknown. */
  netCostNZD: number | null;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase();

/** Does this tuition row apply to this (student, programme)? */
export function tuitionMatches(row: TuitionRow, ctx: PricingContext): boolean {
  if (!row.isActive) return false;
  if (norm(row.nationality) !== norm(ctx.nationality)) return false;
  if (row.programmeId !== null && row.programmeId !== ctx.programmeId) return false;
  if (row.level !== null && norm(row.level) !== norm(ctx.level)) return false;
  return true;
}

/**
 * Specificity score — the MOST SPECIFIC matching row wins.
 * Tuition is one applicable figure, not a sum: a programme+level rate must beat a
 * provider-wide rate, or a student would be quoted the wrong (usually generic) fee.
 */
function specificity(row: TuitionRow): number {
  return (row.programmeId !== null ? 2 : 0) + (row.level !== null ? 1 : 0);
}

/**
 * Resolve the student's tuition.
 * Falls back to the programme's flat fee and SAYS SO via `source`.
 */
export function resolveStudentTuition(rows: TuitionRow[], ctx: PricingContext): ResolvedTuition {
  const candidates = rows.filter((r) => tuitionMatches(r, ctx));

  // Non-NZD rows cannot be compared or netted without an FX table — same rule as
  // scholarships. Surface it rather than quoting a wrong number.
  const usable = candidates.filter((r) => norm(r.currency) === 'NZD');
  const skippedForCurrency = candidates.length - usable.length;

  if (usable.length) {
    usable.sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        (b.feeYear ?? 0) - (a.feeYear ?? 0) ||
        a.id.localeCompare(b.id), // deterministic final tiebreak
    );
    const win = usable[0];
    return {
      amountNZD: round2(win.amountValue),
      source: 'NATIONALITY_SPECIFIC',
      rowId: win.id,
      feeYear: win.feeYear,
      note: skippedForCurrency
        ? `${skippedForCurrency} matching rate(s) ignored — not denominated in NZD.`
        : null,
    };
  }

  if (ctx.defaultTuitionNZD != null && Number.isFinite(ctx.defaultTuitionNZD)) {
    return {
      amountNZD: round2(ctx.defaultTuitionNZD),
      source: 'DEFAULT',
      rowId: null,
      feeYear: null,
      note: skippedForCurrency
        ? `Nationality-specific rate exists but is not in NZD; showing the default fee.`
        : null,
    };
  }

  return { amountNZD: null, source: 'UNKNOWN', rowId: null, feeYear: null, note: null };
}

/** Resolve BOTH figures for one student on one programme, in one place. */
export function resolveStudentPricing(
  tuitionRows: TuitionRow[],
  scholarshipRows: ScholarshipRow[],
  ctx: PricingContext,
): StudentPricing {
  const tuition = resolveStudentTuition(tuitionRows, ctx);

  // The student's OWN tuition drives percentage scholarships — a "20% of tuition"
  // award is worth more to a student paying the higher international rate.
  const scholarship = computeScholarshipTotal(scholarshipRows, {
    nationality: ctx.nationality,
    programmeId: ctx.programmeId,
    level: ctx.level,
    tuitionFeeNZD: tuition.amountNZD,
  });

  const netCostNZD =
    tuition.amountNZD == null ? null : round2(Math.max(0, tuition.amountNZD - scholarship.totalNZD));

  return { tuition, scholarship, netCostNZD };
}

// ─── Explore-page sort keys (both nationality-aware) ──────────────────────────

/**
 * "Lowest tuition fee" sort key. Programmes with no known tuition sort LAST
 * (Infinity) rather than appearing free.
 */
export function tuitionSortKey(p: StudentPricing): number {
  return p.tuition.amountNZD == null ? Number.POSITIVE_INFINITY : p.tuition.amountNZD;
}

/** "Highest scholarship" sort key — no applicable scholarship sorts below zero. */
export function scholarshipSortKey(p: StudentPricing): number {
  return p.scholarship.lines.length === 0 ? -1 : p.scholarship.totalNZD;
}

/** "Lowest net cost" — the figure a student actually cares about. */
export function netCostSortKey(p: StudentPricing): number {
  return p.netCostNZD == null ? Number.POSITIVE_INFINITY : p.netCostNZD;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
