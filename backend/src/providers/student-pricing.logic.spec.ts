import {
  resolveStudentTuition,
  resolveStudentPricing,
  tuitionSortKey,
  scholarshipSortKey,
  type TuitionRow,
  type PricingContext,
} from './student-pricing.logic';
import type { ScholarshipRow } from './scholarship-total.logic';

const t = (over: Partial<TuitionRow>): TuitionRow => ({
  id: 't1',
  nationality: 'IR',
  groupNationalities: null,
  programmeId: null,
  level: null,
  amountValue: 22000,
  currency: 'NZD',
  feeYear: 2027,
  isActive: true,
  ...over,
});

const s = (over: Partial<ScholarshipRow>): ScholarshipRow => ({
  id: 's1',
  name: 'Award',
  nationality: 'IR',
  groupNationalities: null,
  programmeId: null,
  level: null,
  amountType: 'FIXED',
  amountValue: 3000,
  currency: 'NZD',
  isActive: true,
  ...over,
});

const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({
  nationality: 'IR',
  programmeId: 'prog-1',
  level: 'MASTERS',
  defaultTuitionNZD: 22000,
  ...over,
});

describe('resolveStudentTuition — fallback is explicit, never silent', () => {
  it('uses the nationality-specific rate when one matches', () => {
    const r = resolveStudentTuition([t({ amountValue: 18000 })], ctx());
    expect(r).toMatchObject({ amountNZD: 18000, source: 'NATIONALITY_SPECIFIC' });
  });

  it('falls back to the programme default AND says so', () => {
    const r = resolveStudentTuition([t({ nationality: 'IN' })], ctx({ nationality: 'IR' }));
    expect(r).toMatchObject({ amountNZD: 22000, source: 'DEFAULT', rowId: null });
  });

  it('reports UNKNOWN when there is no rate and no default', () => {
    expect(resolveStudentTuition([], ctx({ defaultTuitionNZD: null }))).toMatchObject({
      amountNZD: null,
      source: 'UNKNOWN',
    });
  });

  it('is PERSONALISED — different nationalities get different tuition', () => {
    const rows = [
      t({ id: 'a', nationality: 'IR', amountValue: 18000 }),
      t({ id: 'b', nationality: 'IN', amountValue: 25000 }),
    ];
    expect(resolveStudentTuition(rows, ctx({ nationality: 'IR' })).amountNZD).toBe(18000);
    expect(resolveStudentTuition(rows, ctx({ nationality: 'IN' })).amountNZD).toBe(25000);
    expect(resolveStudentTuition(rows, ctx({ nationality: 'CN' })).source).toBe('DEFAULT');
  });

  it('MOST SPECIFIC row wins — programme+level beats provider-wide', () => {
    const rows = [
      t({ id: 'wide', programmeId: null, level: null, amountValue: 30000 }),
      t({ id: 'prog', programmeId: 'prog-1', level: null, amountValue: 20000 }),
      t({ id: 'both', programmeId: 'prog-1', level: 'MASTERS', amountValue: 18000 }),
    ];
    expect(resolveStudentTuition(rows, ctx()).rowId).toBe('both');
  });

  it('breaks a specificity tie on the most recent fee year', () => {
    const rows = [
      t({ id: 'old', programmeId: 'prog-1', feeYear: 2026, amountValue: 19000 }),
      t({ id: 'new', programmeId: 'prog-1', feeYear: 2027, amountValue: 21000 }),
    ];
    expect(resolveStudentTuition(rows, ctx()).rowId).toBe('new');
  });

  it('ignores a non-NZD rate but reports it rather than quoting it', () => {
    const r = resolveStudentTuition([t({ currency: 'USD', amountValue: 15000 })], ctx());
    expect(r.source).toBe('DEFAULT');
    expect(r.note).toMatch(/not in NZD/i);
  });

  it('ignores inactive rows', () => {
    expect(resolveStudentTuition([t({ isActive: false, amountValue: 1 })], ctx()).source).toBe('DEFAULT');
  });
});

describe('resolveStudentPricing — both figures, one moment, one nationality', () => {
  it('THE WORKED EXAMPLE: Iranian student, nationality tuition + summed scholarships', () => {
    const tuitionRows = [t({ id: 'ir-rate', nationality: 'IR', amountValue: 18000 })];
    const scholarshipRows = [
      s({ id: 'a', name: 'Iran Merit Award', amountValue: 3000 }),
      s({ id: 'b', name: 'Faculty Bursary', amountValue: 1500 }),
    ];
    const p = resolveStudentPricing(tuitionRows, scholarshipRows, ctx({ defaultTuitionNZD: 22000 }));

    expect(p.tuition).toMatchObject({ amountNZD: 18000, source: 'NATIONALITY_SPECIFIC' });
    expect(p.scholarship.totalNZD).toBe(4500);
    expect(p.netCostNZD).toBe(13500);
  });

  it('a different nationality on the SAME programme gets a different everything', () => {
    const tuitionRows = [
      t({ id: 'ir', nationality: 'IR', amountValue: 18000 }),
      t({ id: 'in', nationality: 'IN', amountValue: 25000 }),
    ];
    const scholarshipRows = [
      s({ id: 'a', nationality: 'IR', amountValue: 3000 }),
      s({ id: 'b', nationality: 'IR', amountValue: 1500 }),
      s({ id: 'c', nationality: 'IN', amountValue: 1000 }),
    ];
    const ir = resolveStudentPricing(tuitionRows, scholarshipRows, ctx({ nationality: 'IR' }));
    const inn = resolveStudentPricing(tuitionRows, scholarshipRows, ctx({ nationality: 'IN' }));

    expect([ir.tuition.amountNZD, ir.scholarship.totalNZD, ir.netCostNZD]).toEqual([18000, 4500, 13500]);
    expect([inn.tuition.amountNZD, inn.scholarship.totalNZD, inn.netCostNZD]).toEqual([25000, 1000, 24000]);
  });

  it('percentage scholarships resolve against the STUDENT-SPECIFIC tuition', () => {
    // 20% is worth more to the student paying the higher rate.
    const pct = [s({ id: 'p', amountType: 'PERCENTAGE', amountValue: 20 })];
    const low = resolveStudentPricing([t({ amountValue: 18000 })], pct, ctx());
    const high = resolveStudentPricing([t({ amountValue: 30000 })], pct, ctx());
    expect(low.scholarship.totalNZD).toBe(3600);
    expect(high.scholarship.totalNZD).toBe(6000);
  });

  it('net cost floors at zero — a scholarship larger than tuition is not negative', () => {
    const p = resolveStudentPricing([t({ amountValue: 2000 })], [s({ amountValue: 5000 })], ctx());
    expect(p.netCostNZD).toBe(0);
  });

  it('net cost is null when tuition is unknown, not a misleading 0', () => {
    const p = resolveStudentPricing([], [s({ amountValue: 3000 })], ctx({ defaultTuitionNZD: null }));
    expect(p.tuition.source).toBe('UNKNOWN');
    expect(p.netCostNZD).toBeNull();
  });
});

describe('sort keys are nationality-aware', () => {
  it('two nationalities can order the SAME programme list differently', () => {
    const progA = { id: 'A', def: 20000 };
    const progB = { id: 'B', def: 24000 };
    const rows = [
      t({ id: '1', nationality: 'IR', programmeId: 'A', amountValue: 20000 }),
      t({ id: '2', nationality: 'IR', programmeId: 'B', amountValue: 24000 }),
      // India gets a discounted rate on B, flipping the cheapest option.
      t({ id: '3', nationality: 'IN', programmeId: 'A', amountValue: 20000 }),
      t({ id: '4', nationality: 'IN', programmeId: 'B', amountValue: 15000 }),
    ];
    const price = (nat: string, p: { id: string; def: number }) =>
      resolveStudentPricing(rows, [], { nationality: nat, programmeId: p.id, level: null, defaultTuitionNZD: p.def });

    const orderFor = (nat: string) =>
      [progA, progB]
        .map((p) => ({ id: p.id, k: tuitionSortKey(price(nat, p)) }))
        .sort((x, y) => x.k - y.k)
        .map((x) => x.id);

    expect(orderFor('IR')).toEqual(['A', 'B']);
    expect(orderFor('IN')).toEqual(['B', 'A']); // genuinely different order
  });

  it('unknown tuition sorts last, not first', () => {
    const known = resolveStudentPricing([t({ amountValue: 30000 })], [], ctx());
    const unknown = resolveStudentPricing([], [], ctx({ defaultTuitionNZD: null }));
    expect(tuitionSortKey(known)).toBeLessThan(tuitionSortKey(unknown));
  });

  it('no scholarship sorts below a zero-value scholarship', () => {
    const none = resolveStudentPricing([t({})], [], ctx());
    const zero = resolveStudentPricing([t({})], [s({ amountValue: 0 })], ctx());
    expect(scholarshipSortKey(none)).toBeLessThan(scholarshipSortKey(zero));
  });
});
