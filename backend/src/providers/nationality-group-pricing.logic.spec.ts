import {
  resolveStudentTuition, tuitionMatches, specificity, nationalityMatch,
  EXACT_NATIONALITY_TIER,
  type TuitionRow, type PricingContext,
} from './student-pricing.logic';
import { computeScholarshipTotal, type ScholarshipRow } from './scholarship-total.logic';

// PR-PROVIDER-PORTAL slice E — grouped-nationality pricing.
//
// These tests are about money quoted to a real person, so they assert amounts and
// which row won, not just that something matched.

const t = (over: Partial<TuitionRow>): TuitionRow => ({
  id: 't1',
  nationality: 'IR',
  groupNationalities: null,
  programmeId: null,
  level: null,
  amountValue: 30000,
  currency: 'NZD',
  feeYear: 2027,
  isActive: true,
  ...over,
});

const ctx: PricingContext = {
  nationality: 'IR',
  programmeId: 'prog-1',
  level: 'BACHELOR',
  defaultTuitionNZD: 40000,
};

describe('a row reaches a student by naming them or by containing them', () => {
  it('an exact nationality matches', () => {
    expect(nationalityMatch({ nationality: 'IR', groupNationalities: null }, 'IR')).toBe('EXACT');
  });

  it('a group containing the nationality matches', () => {
    expect(nationalityMatch({ nationality: null, groupNationalities: ['IR', 'PK'] }, 'IR')).toBe('GROUP');
  });

  it('a group NOT containing the nationality does not match', () => {
    expect(nationalityMatch({ nationality: null, groupNationalities: ['PK', 'IN'] }, 'IR')).toBeNull();
  });

  it('is case- and whitespace-insensitive on both sides', () => {
    expect(nationalityMatch({ nationality: null, groupNationalities: [' ir '] }, 'Ir')).toBe('GROUP');
    expect(nationalityMatch({ nationality: ' ir ', groupNationalities: null }, 'IR')).toBe('EXACT');
  });

  it('an empty nationality matches nothing — never everything', () => {
    expect(nationalityMatch({ nationality: null, groupNationalities: ['IR'] }, '')).toBeNull();
    expect(nationalityMatch({ nationality: 'IR', groupNationalities: null }, '  ')).toBeNull();
  });

  it('tuitionMatches accepts a group row', () => {
    expect(tuitionMatches(t({ nationality: null, groupNationalities: ['IR', 'PK'] }), ctx)).toBe(true);
    expect(tuitionMatches(t({ nationality: null, groupNationalities: ['PK'] }), ctx)).toBe(false);
  });

  it('an inactive group row still does not match', () => {
    expect(tuitionMatches(t({ nationality: null, groupNationalities: ['IR'], isActive: false }), ctx)).toBe(false);
  });
});

describe('AN EXACT NATIONALITY OUTRANKS A GROUP — always', () => {
  // The tier has to beat everything below it COMBINED, or a programme+level group
  // rate would overrule a provider-wide exact rate. Asserted as a relationship so
  // adding a term below without raising the tier fails here.
  it('the exact tier exceeds the sum of every other specificity term', () => {
    const maxOthers = specificity(
      t({ nationality: null, groupNationalities: ['IR'], programmeId: 'prog-1', level: 'BACHELOR' }),
      'IR',
    );
    expect(maxOthers).toBe(3);
    expect(EXACT_NATIONALITY_TIER).toBeGreaterThan(maxOthers);
  });

  it('THE CASE THAT MATTERS: a provider-wide exact rate beats a programme+level group rate', () => {
    const exactBroad = t({ id: 'exact', nationality: 'IR', amountValue: 30000, programmeId: null, level: null });
    const groupNarrow = t({
      id: 'group', nationality: null, groupNationalities: ['IR', 'PK', 'IN'],
      amountValue: 25000, programmeId: 'prog-1', level: 'BACHELOR',
    });

    // Both genuinely match — this is a contest, not a filter.
    expect(tuitionMatches(exactBroad, ctx)).toBe(true);
    expect(tuitionMatches(groupNarrow, ctx)).toBe(true);

    const resolved = resolveStudentTuition([groupNarrow, exactBroad], ctx);
    expect(resolved.rowId).toBe('exact');
    expect(resolved.amountNZD).toBe(30000);
    expect(resolved.matchedVia).toBe('EXACT');
  });

  it('and the order the rows arrive in makes no difference', () => {
    const exact = t({ id: 'exact', nationality: 'IR', amountValue: 30000 });
    const group = t({ id: 'group', nationality: null, groupNationalities: ['IR'], amountValue: 25000, programmeId: 'prog-1', level: 'BACHELOR' });
    expect(resolveStudentTuition([exact, group], ctx).rowId).toBe('exact');
    expect(resolveStudentTuition([group, exact], ctx).rowId).toBe('exact');
  });

  it('a newer feeYear on the group row still does not beat exact', () => {
    const exact = t({ id: 'exact', nationality: 'IR', amountValue: 30000, feeYear: 2025 });
    const group = t({ id: 'group', nationality: null, groupNationalities: ['IR'], amountValue: 25000, feeYear: 2099, programmeId: 'prog-1', level: 'BACHELOR' });
    expect(resolveStudentTuition([exact, group], ctx).rowId).toBe('exact');
  });

  it('among GROUP rows the ordinary specificity rules still apply', () => {
    const broad = t({ id: 'broad', nationality: null, groupNationalities: ['IR'], amountValue: 28000 });
    const narrow = t({ id: 'narrow', nationality: null, groupNationalities: ['IR'], amountValue: 26000, programmeId: 'prog-1', level: 'BACHELOR' });
    const r = resolveStudentTuition([broad, narrow], ctx);
    expect(r.rowId).toBe('narrow');
    expect(r.amountNZD).toBe(26000);
    expect(r.matchedVia).toBe('GROUP');
  });

  it('among EXACT rows the ordinary specificity rules still apply', () => {
    const broad = t({ id: 'broad', nationality: 'IR', amountValue: 30000 });
    const narrow = t({ id: 'narrow', nationality: 'IR', amountValue: 31000, programmeId: 'prog-1' });
    expect(resolveStudentTuition([broad, narrow], ctx).rowId).toBe('narrow');
  });

  it('a group row is used when there is no exact row — not the flat fee', () => {
    const group = t({ id: 'group', nationality: null, groupNationalities: ['IR'], amountValue: 27000 });
    const r = resolveStudentTuition([group], ctx);
    expect(r.amountNZD).toBe(27000);
    expect(r.source).toBe('NATIONALITY_SPECIFIC');
    expect(r.matchedVia).toBe('GROUP');
  });

  it('a group that excludes the student falls back to the flat fee, and says so', () => {
    const group = t({ nationality: null, groupNationalities: ['PK', 'IN'], amountValue: 27000 });
    const r = resolveStudentTuition([group], ctx);
    expect(r.source).toBe('DEFAULT');
    expect(r.amountNZD).toBe(40000);
    expect(r.matchedVia).toBeNull();
  });
});

describe('scholarships SUM rather than outrank', () => {
  const s = (over: Partial<ScholarshipRow>): ScholarshipRow => ({
    id: 's1', name: 'Award', nationality: 'IR', groupNationalities: null,
    programmeId: null, level: null, amountType: 'FIXED', amountValue: 1000,
    currency: 'NZD', isActive: true, ...over,
  });
  const sctx = { nationality: 'IR', programmeId: 'prog-1', level: 'BACHELOR', tuitionFeeNZD: 30000 };

  it('a group award applies to a member', () => {
    const total = computeScholarshipTotal([s({ nationality: null, groupNationalities: ['IR', 'PK'], amountValue: 2000 })], sctx);
    expect(total.totalNZD).toBe(2000);
  });

  it('an exact award and a group award BOTH count — they do not compete', () => {
    // The Owner's summing rule, applied to groups: two distinct funding sources.
    // Recorded explicitly because it is the opposite of the tuition rule and the
    // difference is money.
    const total = computeScholarshipTotal([
      s({ id: 'exact', name: 'India award', amountValue: 3000 }),
      s({ id: 'group', name: 'South Asia award', nationality: null, groupNationalities: ['IR', 'PK'], amountValue: 2000 }),
    ], sctx);
    expect(total.totalNZD).toBe(5000);
    expect(total.lines.map((l) => l.name).sort()).toEqual(['India award', 'South Asia award']);
  });

  it('a group award the student is not in contributes nothing', () => {
    const total = computeScholarshipTotal([s({ nationality: null, groupNationalities: ['PK'], amountValue: 2000 })], sctx);
    expect(total.totalNZD).toBe(0);
    expect(total.lines).toEqual([]);
  });

  it('a percentage group award still resolves against the student’s own tuition', () => {
    const total = computeScholarshipTotal(
      [s({ nationality: null, groupNationalities: ['IR'], amountType: 'PERCENTAGE', amountValue: 20 })],
      sctx,
    );
    expect(total.totalNZD).toBe(6000); // 20% of 30000
  });
});
