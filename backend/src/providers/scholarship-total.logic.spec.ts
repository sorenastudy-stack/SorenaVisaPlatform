import {
  computeScholarshipTotal,
  matchesStudent,
  resolveAmountNZD,
  scholarshipSortKey,
  type ScholarshipRow,
  type ScholarshipContext,
} from './scholarship-total.logic';

const row = (over: Partial<ScholarshipRow>): ScholarshipRow => ({
  id: 's1',
  name: 'Scholarship',
  nationality: 'IR',
  groupNationalities: null,
  programmeId: null,
  level: null,
  amountType: 'FIXED',
  amountValue: 1000,
  currency: 'NZD',
  isActive: true,
  ...over,
});

const ctx = (over: Partial<ScholarshipContext> = {}): ScholarshipContext => ({
  nationality: 'IR',
  programmeId: 'prog-1',
  level: 'MASTERS',
  tuitionFeeNZD: 40000,
  ...over,
});

describe('matchesStudent', () => {
  it('matches an unscoped row for the same nationality', () => {
    expect(matchesStudent(row({}), ctx())).toBe(true);
  });

  it('rejects a different nationality', () => {
    expect(matchesStudent(row({ nationality: 'IN' }), ctx())).toBe(false);
  });

  it('is case/whitespace insensitive on nationality', () => {
    expect(matchesStudent(row({ nationality: ' ir ' }), ctx({ nationality: 'IR' }))).toBe(true);
  });

  it('rejects an inactive row', () => {
    expect(matchesStudent(row({ isActive: false }), ctx())).toBe(false);
  });

  it('matches a programme-scoped row only for that programme', () => {
    expect(matchesStudent(row({ programmeId: 'prog-1' }), ctx())).toBe(true);
    expect(matchesStudent(row({ programmeId: 'prog-2' }), ctx())).toBe(false);
  });

  it('matches a level-scoped row only at that level', () => {
    expect(matchesStudent(row({ level: 'MASTERS' }), ctx())).toBe(true);
    expect(matchesStudent(row({ level: 'BACHELORS' }), ctx())).toBe(false);
  });

  it('fails closed when the programme level is unknown and the row is level-scoped', () => {
    expect(matchesStudent(row({ level: 'MASTERS' }), ctx({ level: null }))).toBe(false);
  });
});

describe('resolveAmountNZD', () => {
  it('returns a FIXED amount as-is', () => {
    expect(resolveAmountNZD(row({ amountValue: 3000 }), 40000)).toEqual({ amountNZD: 3000 });
  });

  it('resolves PERCENTAGE against tuition', () => {
    expect(resolveAmountNZD(row({ amountType: 'PERCENTAGE', amountValue: 20 }), 40000)).toEqual({
      amountNZD: 8000,
    });
  });

  it('refuses PERCENTAGE with no tuition rather than treating it as 0', () => {
    const r = resolveAmountNZD(row({ amountType: 'PERCENTAGE', amountValue: 20 }), null);
    expect(r).toMatchObject({ reason: 'PERCENTAGE_WITHOUT_TUITION' });
  });

  it('refuses a non-NZD currency rather than summing it blind', () => {
    const r = resolveAmountNZD(row({ currency: 'USD', amountValue: 5000 }), 40000);
    expect(r).toMatchObject({ reason: 'UNSUPPORTED_CURRENCY' });
  });
});

describe('computeScholarshipTotal — the Owner correction', () => {
  // The worked example from the Round 2 brief.
  it('SUMS multiple matching rows for one nationality on one programme', () => {
    const rows = [
      row({ id: 'a', name: 'Iran Merit Award', amountValue: 3000 }),
      row({ id: 'b', name: 'Faculty Bursary', amountValue: 1500 }),
    ];
    const result = computeScholarshipTotal(rows, ctx());

    expect(result.totalNZD).toBe(4500);
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((l) => l.name)).toEqual(['Iran Merit Award', 'Faculty Bursary']);
  });

  it('sums three rows across provider-wide, programme-scoped and level-scoped', () => {
    const rows = [
      row({ id: 'a', name: 'Provider-wide', amountValue: 2000, programmeId: null, level: null }),
      row({ id: 'b', name: 'Programme-specific', amountValue: 1200, programmeId: 'prog-1' }),
      row({ id: 'c', name: 'Masters-only', amountValue: 800, level: 'MASTERS' }),
    ];
    expect(computeScholarshipTotal(rows, ctx()).totalNZD).toBe(4000);
  });

  it('is PERSONALISED — a different nationality gets a different total', () => {
    const rows = [
      row({ id: 'a', nationality: 'IR', name: 'Iran Award', amountValue: 3000 }),
      row({ id: 'b', nationality: 'IR', name: 'Iran Bursary', amountValue: 1500 }),
      row({ id: 'c', nationality: 'IN', name: 'India Award', amountValue: 1000 }),
    ];
    expect(computeScholarshipTotal(rows, ctx({ nationality: 'IR' })).totalNZD).toBe(4500);
    expect(computeScholarshipTotal(rows, ctx({ nationality: 'IN' })).totalNZD).toBe(1000);
    // Nobody ever sees a blended "average" figure.
    expect(computeScholarshipTotal(rows, ctx({ nationality: 'CN' })).totalNZD).toBe(0);
  });

  it('NORMALISES a percentage to NZD before summing it with a flat amount', () => {
    const rows = [
      row({ id: 'a', name: 'Flat', amountValue: 3000 }),
      row({ id: 'b', name: 'Percent', amountType: 'PERCENTAGE', amountValue: 10 }), // 10% of 40k
    ];
    const result = computeScholarshipTotal(rows, ctx({ tuitionFeeNZD: 40000 }));
    // 3000 + 4000 — NOT 3000 + 10.
    expect(result.totalNZD).toBe(7000);
    expect(result.lines.find((l) => l.id === 'b')).toMatchObject({ amountNZD: 4000, rawValue: 10 });
  });

  it('excludes unresolvable rows from the total but reports them', () => {
    const rows = [
      row({ id: 'a', name: 'Good', amountValue: 2000 }),
      row({ id: 'b', name: 'Pct no tuition', amountType: 'PERCENTAGE', amountValue: 25 }),
      row({ id: 'c', name: 'US dollars', currency: 'USD', amountValue: 9999 }),
    ];
    const result = computeScholarshipTotal(rows, ctx({ tuitionFeeNZD: null }));
    expect(result.totalNZD).toBe(2000);
    expect(result.unresolved.map((u) => u.reason).sort()).toEqual([
      'PERCENTAGE_WITHOUT_TUITION',
      'UNSUPPORTED_CURRENCY',
    ]);
  });

  it('returns an empty, zero total when nothing matches', () => {
    const result = computeScholarshipTotal([row({ nationality: 'IN' })], ctx({ nationality: 'IR' }));
    expect(result).toEqual({ totalNZD: 0, lines: [], unresolved: [] });
  });

  it('orders the breakdown largest-first, deterministically', () => {
    const rows = [
      row({ id: 'a', name: 'Small', amountValue: 500 }),
      row({ id: 'b', name: 'Big', amountValue: 5000 }),
      row({ id: 'c', name: 'Mid', amountValue: 1500 }),
    ];
    expect(computeScholarshipTotal(rows, ctx()).lines.map((l) => l.name)).toEqual([
      'Big',
      'Mid',
      'Small',
    ]);
  });

  it('rounds to cents rather than accumulating float error', () => {
    const rows = [
      row({ id: 'a', amountType: 'PERCENTAGE', amountValue: 33.33 }),
      row({ id: 'b', amountValue: 0.1 }),
    ];
    const result = computeScholarshipTotal(rows, ctx({ tuitionFeeNZD: 10000 }));
    expect(result.totalNZD).toBe(3333.1);
  });
});

describe('scholarshipSortKey', () => {
  it('sorts "no scholarship" below a zero-value scholarship', () => {
    const none = computeScholarshipTotal([], ctx());
    const zero = computeScholarshipTotal([row({ amountValue: 0 })], ctx());
    expect(scholarshipSortKey(none)).toBe(-1);
    expect(scholarshipSortKey(zero)).toBe(0);
    expect(scholarshipSortKey(none)).toBeLessThan(scholarshipSortKey(zero));
  });
});
