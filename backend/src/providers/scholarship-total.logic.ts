// PR-EXPLORE (scholarship correction) — per-student scholarship totalling.
//
// NON-NEGOTIABLE (Owner decision, Round 2): there is NO flat, one-size-fits-all
// scholarship figure. Every amount displayed or sorted-by is computed live for the
// SPECIFIC authenticated student's nationality by SUMMING every applicable
// ProviderScholarship row for that (nationality, programme/level) combination.
// A single nationality routinely matches 2-3 rows on one programme (different
// funding sources, all simultaneously applicable) — taking one row's value, or
// showing a generic number to every student, is wrong.
//
// Pure + deterministic: NO DB, NO I/O. The caller loads the candidate rows
// (server-side, scoped to the authenticated student) and passes them in. Mirrors
// programme-choice-rules.logic.ts.
//
// NORMALISE-THEN-SUM: a PERCENTAGE row is resolved against tuition into an NZD
// amount BEFORE summing. Never add a percentage to a flat amount.
//
// FAIL LOUD, NOT SILENT: a row that cannot be resolved to NZD (percentage with no
// tuition on the programme, or a non-NZD currency we have no FX rate for) is
// EXCLUDED from the total and returned in `unresolved` so the UI can surface it.
// Silently treating it as 0 would understate a student's real entitlement.

export type ScholarshipAmountType = 'FIXED' | 'PERCENTAGE';

/** The subset of ProviderScholarship this logic needs. */
export interface ScholarshipRow {
  id: string;
  name: string;
  /** Null when the row is scoped to a group instead — exactly one of the two is set. */
  nationality: string | null; // ISO country code
  /**
   * PR-PROVIDER-PORTAL slice E — the ISO codes of the row's NationalityGroup,
   * already loaded. Null when the row names a single nationality.
   */
  groupNationalities: string[] | null;
  programmeId: string | null; // null = applies to any programme of the provider
  level: string | null; // QualificationLevel; null = applies to any level
  amountType: ScholarshipAmountType;
  amountValue: number;
  currency: string;
  isActive: boolean;
}

/** The (student, programme) pair the total is computed for. */
export interface ScholarshipContext {
  nationality: string; // the AUTHENTICATED student's nationality (ISO)
  programmeId: string;
  level: string | null; // the programme's QualificationLevel
  tuitionFeeNZD: number | null; // needed to resolve PERCENTAGE rows
}

export interface ScholarshipLine {
  id: string;
  name: string;
  amountNZD: number;
  amountType: ScholarshipAmountType;
  /** For PERCENTAGE rows: the original percent, so the UI can show "20% of tuition". */
  rawValue: number;
}

export type UnresolvedReason = 'PERCENTAGE_WITHOUT_TUITION' | 'UNSUPPORTED_CURRENCY';

export interface UnresolvedScholarship {
  id: string;
  name: string;
  reason: UnresolvedReason;
  detail: string;
}

export interface ScholarshipTotal {
  /** The number that sorts and displays. Sum of every resolved matching row. */
  totalNZD: number;
  /** Per-row breakdown for the transparent "A + B = total" display. */
  lines: ScholarshipLine[];
  /** Matched but not summable — surface these, never hide them. */
  unresolved: UnresolvedScholarship[];
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase();

/**
 * PR-PROVIDER-PORTAL slice E — GROUPS SUM, THEY DO NOT OUTRANK.
 *
 * Tuition resolves to ONE figure, so there an exact nationality beats a group
 * outright (see student-pricing.logic). Scholarships are the opposite by an
 * explicit Owner decision recorded at the top of this file: a student routinely
 * holds two or three awards from different funding sources at once, and they are
 * SUMMED. A group award is another distinct funding source, so it adds.
 *
 * The consequence, stated plainly because it involves money: an institution with
 * a "South Asia — $2,000" group award AND an "India — $3,000" award gives an
 * Indian student $5,000, not $3,000. That follows from the summing rule rather
 * than contradicting it — but an institution that MIGRATES a country into a group
 * and forgets to remove the old row has doubled an award by accident. The
 * per-line breakdown names both, so it is visible rather than buried in a total,
 * and staff see the same breakdown at review time before it reaches a student.
 *
 * If the Owner wants exact-suppresses-group here too, this is the one function to
 * change — matchesStudent would filter group rows out when any exact row matched.
 */
export function nationalityMatch(
  row: Pick<ScholarshipRow, 'nationality' | 'groupNationalities'>,
  nationality: string,
): 'EXACT' | 'GROUP' | null {
  const want = norm(nationality);
  if (!want) return null;
  if (row.nationality != null) return norm(row.nationality) === want ? 'EXACT' : null;
  if (row.groupNationalities) {
    return row.groupNationalities.some((c) => norm(c) === want) ? 'GROUP' : null;
  }
  return null;
}

/**
 * Does this scholarship row apply to this (student, programme)?
 * A null programmeId or null level means "unscoped" — applies broadly.
 */
export function matchesStudent(row: ScholarshipRow, ctx: ScholarshipContext): boolean {
  if (!row.isActive) return false;
  if (nationalityMatch(row, ctx.nationality) === null) return false;
  // null programmeId = provider-wide scholarship, applies to this programme too.
  if (row.programmeId !== null && row.programmeId !== ctx.programmeId) return false;
  // null level = any level. A non-null row level must equal the programme's level;
  // an unknown programme level cannot satisfy a level-scoped row (fail closed).
  if (row.level !== null && norm(row.level) !== norm(ctx.level)) return false;
  return true;
}

/**
 * Resolve one matching row to an NZD amount.
 * Returns a reason instead of a number when it cannot be resolved.
 */
export function resolveAmountNZD(
  row: ScholarshipRow,
  tuitionFeeNZD: number | null,
): { amountNZD: number } | { reason: UnresolvedReason; detail: string } {
  // No FX table in this system — anything not already NZD cannot be summed safely.
  if (norm(row.currency) !== 'NZD') {
    return {
      reason: 'UNSUPPORTED_CURRENCY',
      detail: `Amount is in ${norm(row.currency)}; no NZD conversion available.`,
    };
  }
  if (row.amountType === 'PERCENTAGE') {
    if (tuitionFeeNZD == null || !Number.isFinite(tuitionFeeNZD)) {
      return {
        reason: 'PERCENTAGE_WITHOUT_TUITION',
        detail: `${row.amountValue}% of tuition, but this programme has no tuition fee recorded.`,
      };
    }
    return { amountNZD: round2((tuitionFeeNZD * row.amountValue) / 100) };
  }
  return { amountNZD: round2(row.amountValue) };
}

/**
 * THE function. Sum every applicable scholarship for this student on this programme.
 * `rows` may contain rows for other nationalities/programmes — filtering happens here.
 */
export function computeScholarshipTotal(
  rows: ScholarshipRow[],
  ctx: ScholarshipContext,
): ScholarshipTotal {
  const lines: ScholarshipLine[] = [];
  const unresolved: UnresolvedScholarship[] = [];

  for (const row of rows) {
    if (!matchesStudent(row, ctx)) continue;
    const resolved = resolveAmountNZD(row, ctx.tuitionFeeNZD);
    if ('reason' in resolved) {
      unresolved.push({ id: row.id, name: row.name, reason: resolved.reason, detail: resolved.detail });
      continue;
    }
    lines.push({
      id: row.id,
      name: row.name,
      amountNZD: resolved.amountNZD,
      amountType: row.amountType,
      rawValue: row.amountValue,
    });
  }

  // Deterministic order: largest first, then name — so the breakdown renders stably
  // and two students with identical entitlements always see the same ordering.
  lines.sort((a, b) => b.amountNZD - a.amountNZD || a.name.localeCompare(b.name));

  return {
    totalNZD: round2(lines.reduce((sum, l) => sum + l.amountNZD, 0)),
    lines,
    unresolved,
  };
}

/**
 * Sort key for the "highest scholarship" ordering on the Explore page.
 * Programmes with no applicable scholarship sort LAST (not as 0 mixed among ties).
 */
export function scholarshipSortKey(total: ScholarshipTotal): number {
  return total.lines.length === 0 ? -1 : total.totalNZD;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
