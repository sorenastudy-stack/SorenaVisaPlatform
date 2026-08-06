import { sortExploreRows, buildMapPins, type ExploreRow } from './explore.logic';

const row = (over: Partial<ExploreRow> & { programmeId: string }): ExploreRow => ({
  programmeName: 'Programme ' + over.programmeId,
  providerId: 'p1', providerName: 'Provider One', isFeatured: false,
  latitude: -36.85, longitude: 174.76,
  pricing: {
    tuition: { amountNZD: 20000, source: 'DEFAULT', rowId: null, feeYear: null, note: null },
    scholarship: { totalNZD: 0, applied: [], unresolved: [] },
    netCostNZD: 20000,
  } as any,
  ...over,
});

const priced = (tuition: number | null, scholarship: number, net: number | null) => ({
  tuition: { amountNZD: tuition, source: 'DEFAULT', rowId: null, feeYear: null, note: null },
  scholarship: { totalNZD: scholarship, applied: [], unresolved: [] },
  netCostNZD: net,
}) as any;

describe('featured-first — the commercial rule, applied to every sort', () => {
  it('puts a featured institution ahead of a cheaper non-featured one', () => {
    const rows = [
      row({ programmeId: 'cheap', pricing: priced(10000, 0, 10000) }),
      row({ programmeId: 'featured', isFeatured: true, pricing: priced(30000, 0, 30000) }),
    ];
    expect(sortExploreRows(rows, 'lowestTuition').map((r) => r.programmeId)).toEqual(['featured', 'cheap']);
  });

  it('still ranks featured institutions against each other on the chosen measure', () => {
    // "Featured" moves you to the front of the queue; it does not reorder the queue.
    const rows = [
      row({ programmeId: 'f-expensive', isFeatured: true, pricing: priced(40000, 0, 40000) }),
      row({ programmeId: 'f-cheap', isFeatured: true, pricing: priced(15000, 0, 15000) }),
      row({ programmeId: 'plain', pricing: priced(9000, 0, 9000) }),
    ];
    expect(sortExploreRows(rows, 'lowestTuition').map((r) => r.programmeId))
      .toEqual(['f-cheap', 'f-expensive', 'plain']);
  });

  it('applies featured-first to the default sort too', () => {
    const rows = [
      row({ programmeId: 'a', providerName: 'AAA College' }),
      row({ programmeId: 'z', providerName: 'ZZZ College', isFeatured: true }),
    ];
    expect(sortExploreRows(rows, 'featured').map((r) => r.programmeId)).toEqual(['z', 'a']);
  });
});

describe('unknown values never rank as "best"', () => {
  it('an unparsed tuition sorts LAST on lowest-tuition, not first', () => {
    // Otherwise "price unknown" would read as "cheapest".
    const rows = [
      row({ programmeId: 'unknown', pricing: priced(null, 0, null) }),
      row({ programmeId: 'known', pricing: priced(25000, 0, 25000) }),
    ];
    expect(sortExploreRows(rows, 'lowestTuition').map((r) => r.programmeId)).toEqual(['known', 'unknown']);
  });

  it('an unknown net cost sorts last too', () => {
    const rows = [
      row({ programmeId: 'unknown', pricing: priced(null, 5000, null) }),
      row({ programmeId: 'known', pricing: priced(30000, 5000, 25000) }),
    ];
    expect(sortExploreRows(rows, 'lowestNetCost').map((r) => r.programmeId)).toEqual(['known', 'unknown']);
  });

  it('a zero scholarship is a known answer and sorts normally', () => {
    const rows = [
      row({ programmeId: 'none', pricing: priced(20000, 0, 20000) }),
      row({ programmeId: 'some', pricing: priced(20000, 4000, 16000) }),
    ];
    expect(sortExploreRows(rows, 'highestScholarship').map((r) => r.programmeId)).toEqual(['some', 'none']);
  });
});

describe('buildMapPins — one pin per institution, none silently dropped', () => {
  it('groups programmes to a single pin with a count', () => {
    const rows = [
      row({ programmeId: 'a', providerId: 'p1', pricing: priced(20000, 0, 20000) }),
      row({ programmeId: 'b', providerId: 'p1', pricing: priced(18000, 0, 18000) }),
      row({ programmeId: 'c', providerId: 'p2', providerName: 'Provider Two', pricing: priced(30000, 0, 30000) }),
    ];
    const { pins } = buildMapPins(rows);
    expect(pins).toHaveLength(2);
    expect(pins.find((p) => p.providerId === 'p1')!.programmeCount).toBe(2);
    expect(pins.find((p) => p.providerId === 'p1')!.fromNetCostNZD).toBe(18000);
  });

  it('reports institutions with no coordinate instead of dropping them', () => {
    const rows = [
      row({ programmeId: 'a', providerId: 'p1' }),
      row({ programmeId: 'b', providerId: 'nopin', providerName: 'Eastwest College', latitude: null, longitude: null }),
    ];
    const { pins, unmapped } = buildMapPins(rows);
    expect(pins.map((p) => p.providerId)).toEqual(['p1']);
    expect(unmapped).toEqual([{ providerId: 'nopin', providerName: 'Eastwest College', programmeCount: 1 }]);
  });

  it('leaves fromNetCost null when no programme has a known cost', () => {
    const rows = [row({ programmeId: 'a', pricing: priced(null, 0, null) })];
    expect(buildMapPins(rows).pins[0].fromNetCostNZD).toBeNull();
  });

  it('orders featured pins last so they paint on top of overlapping markers', () => {
    const rows = [
      row({ programmeId: 'a', providerId: 'feat', isFeatured: true }),
      row({ programmeId: 'b', providerId: 'plain' }),
    ];
    expect(buildMapPins(rows).pins.map((p) => p.providerId)).toEqual(['plain', 'feat']);
  });
});
