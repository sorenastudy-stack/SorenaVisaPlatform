import { parseTuition, parseNzqfLevel, parseYear, headerIndex, providerTypeFor, subjectAreasFor, UNSPECIFIED_SUBJECT_AREA, type ParsedProgrammeRow } from './catalogue-workbook.logic';

describe('parseTuition — three source formats, one parser', () => {
  it('parses the ITP "$" format', () => {
    expect(parseTuition('$26,572 per year')).toEqual({ amount: 26572, note: null });
  });

  it('parses the University "NZD" format', () => {
    expect(parseTuition('NZD 48,133 per year')).toEqual({ amount: 48133, note: null });
  });

  it('parses the PTE bare comma-grouped format', () => {
    expect(parseTuition('22,000')).toEqual({ amount: 22000, note: null });
  });

  it('parses cents', () => {
    expect(parseTuition('NZD 47,674.80 per year')).toEqual({ amount: 47674.8, note: null });
  });

  // ── the reason raw text is always kept ──
  it('refuses a conditional per-credit fee rather than picking one number', () => {
    const r = parseTuition('$13,286 per 60 credits or $26,572 per 120 credits (programme dependent)');
    expect(r.amount).toBeNull();
    expect(r.note).toMatch(/conditional/);
  });

  it('refuses a range', () => {
    expect(parseTuition('$27,458–$27,635 per year').amount).toBeNull();
  });

  it('refuses a base fee with an extra component', () => {
    const r = parseTuition('22,000 (plus 2,400 resource/admin fee)');
    expect(r.amount).toBeNull();
    expect(r.note).toMatch(/conditional/);
  });

  it('refuses a single figure carrying hedging language', () => {
    const r = parseTuition('NZD 48,133 per year (approx.)');
    expect(r.amount).toBeNull();
    expect(r.note).toMatch(/qualified/);
  });

  it('reports TBC rather than inventing zero', () => {
    expect(parseTuition('TBC')).toMatchObject({ amount: null, note: 'no numeric amount found' });
    expect(parseTuition('To be confirmed')).toMatchObject({ amount: null });
    expect(parseTuition(null)).toMatchObject({ amount: null, note: 'no fee stated in source' });
  });

  // ── the numerics that share these cells and must NOT be read as money ──
  it('does not mistake credits, points or years for a fee', () => {
    expect(parseTuition('60 credits').amount).toBeNull();
    expect(parseTuition('180-point programme').amount).toBeNull();
    expect(parseTuition('fee applies from 2027').amount).toBeNull();
  });
});

describe('parseNzqfLevel', () => {
  it.each([['4', 4], ['Level 7', 7], [7, 7], ['9', 9]])('parses %s', (raw, want) => {
    expect(parseNzqfLevel(raw)).toBe(want);
  });
  it('rejects out-of-range and blank', () => {
    expect(parseNzqfLevel('99')).toBeNull();
    expect(parseNzqfLevel('')).toBeNull();
    expect(parseNzqfLevel(null)).toBeNull();
  });
});

describe('parseYear', () => {
  it('extracts a 20xx year', () => {
    expect(parseYear(2026)).toBe(2026);
    expect(parseYear('fee year 2027')).toBe(2027);
    expect(parseYear('n/a')).toBeNull();
  });
});

describe('headerIndex', () => {
  it('maps trimmed headers to indexes, first occurrence wins', () => {
    expect(headerIndex([' Provider Entity ', 'Brand', 'Brand'])).toEqual({ 'Provider Entity': 0, Brand: 1 });
  });
});

describe('providerTypeFor — existing enum values only', () => {
  it('maps each source file to an existing ProviderType', () => {
    expect(providerTypeFor('ITP')).toBe('POLYTECHNIC');
    expect(providerTypeFor('PTE')).toBe('COLLEGE');
    expect(providerTypeFor('University')).toBe('UNIVERSITY');
  });
});

describe('subjectAreasFor — per-institution tabs, no shared taxonomy', () => {
  const row = (institutionName: string, subjectAreaRaw: string): ParsedProgrammeRow =>
    ({ institutionName, subjectAreaRaw } as ParsedProgrammeRow);

  it('returns only that institution\'s own labels, largest first', () => {
    const rows = [
      row('Ara', 'Business & Management'),
      row('Ara', 'Business & Management'),
      row('Ara', 'Beauty & Hair'),
      row('AUT', 'Law'),
    ];
    expect(subjectAreasFor(rows, 'Ara')).toEqual([
      { label: 'Business & Management', count: 2 },
      { label: 'Beauty & Hair', count: 1 },
    ]);
  });

  it('keeps blank-subject-area rows visible under "Unspecified"', () => {
    const rows = [row('AGI', UNSPECIFIED_SUBJECT_AREA), row('AGI', UNSPECIFIED_SUBJECT_AREA)];
    expect(subjectAreasFor(rows, 'AGI')).toEqual([{ label: 'Unspecified', count: 2 }]);
  });
});

describe('parseTuition — refinements found by running the real workbooks', () => {
  it('parses an NZD-prefixed bare integer (no comma grouping)', () => {
    expect(parseTuition('NZD 19000 (Year 1)')).toEqual({ amount: 19000, note: null });
    expect(parseTuition('NZD 14000 per year')).toEqual({ amount: 14000, note: null });
  });

  it('rejects an implausible figure rather than quoting it', () => {
    const r = parseTuition('$2');
    expect(r.amount).toBeNull();
    expect(r.note).toMatch(/implausible/);
  });

  it('still refuses an approximate range', () => {
    expect(parseTuition('Approx. NZD 14000-19000 range').amount).toBeNull();
  });

  it('reports genuinely absent fees as non-numeric', () => {
    for (const v of ['Not published', 'Not verified this session', 'Not disclosed as a fixed figure']) {
      expect(parseTuition(v)).toMatchObject({ amount: null, note: 'no numeric amount found' });
    }
  });
});
