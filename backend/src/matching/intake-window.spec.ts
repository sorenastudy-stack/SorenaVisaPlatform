// PR-INTAKE-1 (Slice 1) — GOLDEN freeze for the intake-timing utility. Pins BOTH
// rules, both directions, the nextEligibleIntake→null edge case, and the exact
// 4-month deadline boundary (1 day past must flip). Frozen BEFORE Step 1's live
// dropdown or the submit-time reassignment touch real data. `now` is injected, so
// every case is deterministic.
import {
  inOfferWindow, isConditionalOffer, eligibleIntakes, nextEligibleIntake,
  meetsLiaDeadline, decideReassignment,
} from './intake-window';

const NOW = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01
const CFG = { liaLeadMonths: 4, intakeMinLeadMonths: 5, intakeMaxWindowMonths: 12 };
const d = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m - 1, day));

describe('GOLDEN — inOfferWindow (5-month rule, both boundaries inclusive)', () => {
  it('accepts an intake exactly 5 months out; rejects one 4 months out', () => {
    expect(inOfferWindow({ month: 1, year: 2027 }, NOW, 5, 12)).toBe(true);  // exactly 5mo → accepted
    expect(inOfferWindow({ month: 12, year: 2026 }, NOW, 5, 12)).toBe(false); // 4mo → too soon
  });
  it('accepts an intake exactly 12 months out; rejects one 13 months out', () => {
    expect(inOfferWindow({ month: 8, year: 2027 }, NOW, 5, 12)).toBe(true);  // exactly 12mo → accepted
    expect(inOfferWindow({ month: 9, year: 2027 }, NOW, 5, 12)).toBe(false); // 13mo → beyond window
  });
});

describe('GOLDEN — isConditionalOffer (later calendar year)', () => {
  it('true when the intake is in a later year; false when same year', () => {
    expect(isConditionalOffer({ month: 1, year: 2027 }, NOW)).toBe(true);
    expect(isConditionalOffer({ month: 9, year: 2026 }, NOW)).toBe(false);
  });
});

describe('GOLDEN — eligibleIntakes + nextEligibleIntake (incl. null edge case)', () => {
  it('projects + filters + sorts a programme’s recurring months', () => {
    expect(eligibleIntakes([2, 7], NOW, 5, 12)).toEqual([
      { month: 2, year: 2027 }, { month: 7, year: 2027 },
    ]);
  });
  it('next = the earliest eligible', () => {
    expect(nextEligibleIntake([2, 7], NOW, 5, 12)).toEqual({ month: 2, year: 2027 });
  });
  it('next = NULL when no month qualifies (fail-safe edge case)', () => {
    // Sept: this-year instance is too soon (1mo), next-year is too far (13mo).
    expect(nextEligibleIntake([9], NOW, 5, 12)).toBeNull();
  });
});

describe('GOLDEN — meetsLiaDeadline (exact 4-month boundary)', () => {
  it('meets when submitted ON the mark; misses one day past', () => {
    // Assigned Jun 2027 → deadline = Feb 1 2027.
    expect(meetsLiaDeadline({ month: 6, year: 2027 }, d(2027, 2, 1), 4)).toBe(true);
    expect(meetsLiaDeadline({ month: 6, year: 2027 }, d(2027, 2, 2), 4)).toBe(false); // +1 day → late
  });
});

describe('GOLDEN — decideReassignment (the consequential branch)', () => {
  it('NONE when submitted in time', () => {
    expect(decideReassignment({ month: 12, year: 2027 }, [2, 6, 12], d(2027, 2, 1), CFG))
      .toEqual({ action: 'NONE', nextIntake: null });
  });
  it('REASSIGN to the next valid intake when late but one qualifies', () => {
    expect(decideReassignment({ month: 2, year: 2027 }, [2, 6, 12], d(2027, 1, 1), CFG))
      .toEqual({ action: 'REASSIGN', nextIntake: { month: 6, year: 2027 } });
  });
  it('MANUAL_REVIEW (fail safe, never a guess) when late and NO intake qualifies', () => {
    expect(decideReassignment({ month: 2, year: 2027 }, [3], d(2027, 1, 1), CFG))
      .toEqual({ action: 'MANUAL_REVIEW', nextIntake: null });
  });
});
