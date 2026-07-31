// PR-INTAKE-1 (Slice 1) — pure intake-timing utility. Foundation for BOTH the
// 5-month offer-window rule and the 4-month LIA-deadline / auto-reassignment rule.
//
// Month granularity: a programme's intakes are recurring MONTHS (EducationProgramme
// .intakeMonths), and an intake's start is pinned to the 1st of that month (we do
// NOT parse the free-text ProgrammeIntake.label). Comparisons against "now" are
// day-aware, so an intake 1 day too soon is correctly excluded and a submission
// 1 day past the deadline correctly fails — the exact boundaries the rules hinge on.
//
// Every function takes `now`/`submittedAt` explicitly (never reads the clock) so
// the whole thing is deterministic + freeze-tested before any live wiring.

export interface Intake { month: number; year: number } // month 1..12

// Start of an intake, pinned to the 1st of the month (UTC).
export function intakeStartDate(i: Intake): Date {
  return new Date(Date.UTC(i.year, i.month - 1, 1));
}

// Add n whole months to a date (UTC). n may be negative.
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

// 5-month rule: intake start is at least `minLeadMonths` out AND within
// `maxWindowMonths` of now (inclusive on both ends).
export function inOfferWindow(i: Intake, now: Date, minLeadMonths: number, maxWindowMonths: number): boolean {
  const start = intakeStartDate(i).getTime();
  return start >= addMonths(now, minLeadMonths).getTime()
      && start <= addMonths(now, maxWindowMonths).getTime();
}

// Conditional-offer: intake falls in a later calendar year than now (offer is
// conditional on the institution's acceptance).
export function isConditionalOffer(i: Intake, now: Date): boolean {
  return i.year > now.getUTCFullYear();
}

// Project a programme's recurring intake MONTHS into concrete {month,year} intakes
// that satisfy the offer window — earliest first, de-duplicated.
export function eligibleIntakes(
  intakeMonths: number[], now: Date, minLeadMonths: number, maxWindowMonths: number,
): Intake[] {
  const months = [...new Set(intakeMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))];
  const startYear = now.getUTCFullYear();
  const endYear = startYear + Math.ceil(maxWindowMonths / 12) + 1;
  const out: Intake[] = [];
  for (let year = startYear; year <= endYear; year++) {
    for (const month of months) {
      const i = { month, year };
      if (inOfferWindow(i, now, minLeadMonths, maxWindowMonths)) out.push(i);
    }
  }
  return out.sort((a, b) => intakeStartDate(a).getTime() - intakeStartDate(b).getTime());
}

// The earliest eligible intake — or NULL when none qualifies. NULL is the fail-safe
// edge case: the caller must escalate (flag + urgent task), never guess or pick
// something outside the window.
export function nextEligibleIntake(
  intakeMonths: number[], now: Date, minLeadMonths: number, maxWindowMonths: number,
): Intake | null {
  return eligibleIntakes(intakeMonths, now, minLeadMonths, maxWindowMonths)[0] ?? null;
}

// 4-month rule: a completed application must be SUBMITTED at least `liaLeadMonths`
// before the assigned intake's start. True = submitted in time.
export function meetsLiaDeadline(assigned: Intake, submittedAt: Date, liaLeadMonths: number): boolean {
  const deadline = addMonths(intakeStartDate(assigned), -liaLeadMonths);
  return submittedAt.getTime() <= deadline.getTime();
}

// ── The consequential decision (frozen before any DB wiring) ──────────────────
// At submit time, given the priority-1 assigned intake + the programme's intake
// months + when the student submitted + the country config → what to do.
export type ReassignAction = 'NONE' | 'REASSIGN' | 'MANUAL_REVIEW';
export interface ReassignDecision { action: ReassignAction; nextIntake: Intake | null }

export function decideReassignment(
  assigned: Intake,
  programmeIntakeMonths: number[],
  submittedAt: Date,
  cfg: { liaLeadMonths: number; intakeMinLeadMonths: number; intakeMaxWindowMonths: number },
): ReassignDecision {
  // Submitted in time → nothing changes.
  if (meetsLiaDeadline(assigned, submittedAt, cfg.liaLeadMonths)) {
    return { action: 'NONE', nextIntake: null };
  }
  // Too late → find the next intake that ITSELF satisfies the 5-month rule.
  const next = nextEligibleIntake(programmeIntakeMonths, submittedAt, cfg.intakeMinLeadMonths, cfg.intakeMaxWindowMonths);
  // Found → reassign. None → fail safe to manual review (never silent, never a guess).
  return next ? { action: 'REASSIGN', nextIntake: next } : { action: 'MANUAL_REVIEW', nextIntake: null };
}
