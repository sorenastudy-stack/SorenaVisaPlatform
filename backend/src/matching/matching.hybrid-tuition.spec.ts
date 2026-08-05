// PR-EXPLORE (Round 3) — proves the HYBRID scoping decision:
//   hard budget filter  → uses the student's nationality-resolved tuition
//   soft fit score      → still uses the flat tuitionFeeNZD
// and that omitting resolvedTuitionNZD leaves behaviour byte-identical.
import { passesHardFilter, softScore, type ProgrammeForMatch, type MatchCriteria } from './matching.logic';

const FIELD = 'field-it';

const programme = (over: Partial<ProgrammeForMatch> = {}): ProgrammeForMatch => ({
  id: 'prog-1',
  approved: true,
  providerApproved: true,
  studyFieldIds: [FIELD],
  level: 'MASTERS' as any,
  tuitionFeeNZD: 22000,
  intakeMonths: [2],
  city: 'Auckland',
  req: null,
  ...over,
});

const criteria = (over: Partial<MatchCriteria> = {}): MatchCriteria => ({
  qualificationFieldId: FIELD,
  preferredFieldIds: [FIELD],
  desiredLevels: [],
  currentHighestLevel: null,
  tuitionBudgetNZD: 20000,
  nationality: 'IR',
  ...over,
});

const allowed = new Set([FIELD]);

describe('HYBRID — hard budget filter uses the resolved tuition', () => {
  it('THE WORKED EXAMPLE: flat 22,000 excludes, IR resolved 18,000 includes', () => {
    const p = programme({ tuitionFeeNZD: 22000 });
    const c = criteria({ tuitionBudgetNZD: 20000 });

    // Before: flat fee 22,000 > budget 20,000 → excluded.
    expect(passesHardFilter(p, c, allowed)).toBe(false);

    // After: the IR student's real rate is 18,000 ≤ 20,000 → included.
    const withResolved = programme({ tuitionFeeNZD: 22000, resolvedTuitionNZD: 18000 });
    expect(passesHardFilter(withResolved, c, allowed)).toBe(true);
  });

  it('works in the other direction too — a HIGHER national rate can exclude', () => {
    const c = criteria({ tuitionBudgetNZD: 24000 });
    // Flat fee 22,000 would pass, but this student's real rate is 25,000.
    const p = programme({ tuitionFeeNZD: 22000, resolvedTuitionNZD: 25000 });
    expect(passesHardFilter(p, c, allowed)).toBe(false);
  });

  it('omitting resolvedTuitionNZD leaves the filter EXACTLY as before', () => {
    const c = criteria({ tuitionBudgetNZD: 20000 });
    expect(passesHardFilter(programme({ tuitionFeeNZD: 22000 }), c, allowed)).toBe(false);
    expect(passesHardFilter(programme({ tuitionFeeNZD: 19000 }), c, allowed)).toBe(true);
  });

  it('null resolvedTuitionNZD falls back to the flat fee, not to "no limit"', () => {
    const c = criteria({ tuitionBudgetNZD: 20000 });
    const p = programme({ tuitionFeeNZD: 22000, resolvedTuitionNZD: null });
    expect(passesHardFilter(p, c, allowed)).toBe(false);
  });
});

describe('HYBRID — soft fit score deliberately ignores the resolved tuition', () => {
  it('two students with different resolved rates get the SAME budget score', () => {
    const c = criteria({ tuitionBudgetNZD: 40000 });
    const ir = programme({ tuitionFeeNZD: 22000, resolvedTuitionNZD: 18000 });
    const ind = programme({ tuitionFeeNZD: 22000, resolvedTuitionNZD: 25000 });

    // Same flat fee → same score, so fitScore stays comparable across students
    // and existing frozen snapshots remain reproducible.
    expect(softScore(ir, c)).toBe(softScore(ind, c));
  });

  it('the score still responds to the FLAT fee, proving it reads that field', () => {
    const c = criteria({ tuitionBudgetNZD: 40000 });
    const cheap = programme({ tuitionFeeNZD: 10000 });
    const dear = programme({ tuitionFeeNZD: 35000 });
    expect(softScore(cheap, c)).toBeGreaterThan(softScore(dear, c));
  });
});
