import { parseVerificationStatus, parseTuition, parseNzqfLevel, parseYear, headerIndex, providerTypeFor, subjectAreasFor, aliasedProviderName, isDeferredRow, DEFERRED_ROWS, UNSPECIFIED_SUBJECT_AREA, type ParsedProgrammeRow } from './catalogue-workbook.logic';

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

describe('aliasedProviderName — institutions already tracked under another name', () => {
  it('maps a workbook name onto the platform\'s existing provider', () => {
    expect(aliasedProviderName('Southern Institute of Technology')).toBe('Southern Institute of Technology (SIT)');
    expect(aliasedProviderName('Waikato Institute of Technology')).toBe('Waikato Institute of Technology (Wintec)');
    expect(aliasedProviderName('Whitireia and WelTec Polytechnic')).toBe('Whitireia and WelTec (Whitireia / WelTec)');
  });

  it('ignores punctuation and casing on both sides', () => {
    expect(aliasedProviderName('ICL GRADUATE BUSINESS SCHOOL (ICL Education Limited)')).toBe('ICL');
    expect(aliasedProviderName('  Nelson Marlborough  Institute of Technology  ')).toBe('Nelson Marlborough Institute of Technology (NMIT)');
  });

  // The two the Owner explicitly ruled out — regressions here would silently
  // merge or split real institutions on production.
  it('does NOT alias NZSE onto Future Skills (different institutions)', () => {
    expect(aliasedProviderName('New Zealand Skills and Education College (NZSE)')).toBeNull();
  });

  it('does NOT alias the combined Manukau/Unitec row onto either existing provider', () => {
    expect(aliasedProviderName('Manukau Institute of Technology and Unitec')).toBeNull();
  });

  it('returns null for a genuinely new institution', () => {
    expect(aliasedProviderName('Ara Institute of Canterbury')).toBeNull();
    expect(aliasedProviderName('Some Brand New College')).toBeNull();
  });

  // Added Aug 2026. The platform tracked "Future Skills" long before the
  // catalogue import; without this the workbook's legal name would create a
  // SECOND institution beside the one already in use.
  it('maps the workbook legal name onto the existing Future Skills record', () => {
    expect(aliasedProviderName('Future Skills Academy Limited')).toBe('Future Skills');
  });

  it('does NOT alias Bridge onto ICL despite the shared parent group', () => {
    // Separate NZQA Provider IDs (737569001 vs ICL's own) = separate legal
    // entities. "Part of ICL Education Group" is a parent relationship, not the
    // same institution under two names.
    expect(aliasedProviderName('Bridge International College NZ Limited')).toBeNull();
  });
});

describe('isDeferredRow — rows intentionally held back', () => {
  it('defers both revised Seafield rows', () => {
    expect(isDeferredRow('Seafield School of English Limited', 'New Zealand Certificate in English Language (Academic)', 'Level 4')).toBe(true);
    expect(isDeferredRow('Seafield School of English Limited', 'New Zealand Certificate in English Language (Academic)', 'Level 5')).toBe(true);
  });

  it('accepts a bare level number as well as "Level N"', () => {
    expect(isDeferredRow('Seafield School of English Limited', 'New Zealand Certificate in English Language (Academic)', '5')).toBe(true);
    expect(isDeferredRow('Seafield School of English Limited', 'New Zealand Certificate in English Language (Academic)', 5)).toBe(true);
  });

  it('does NOT defer the OLD Seafield names already imported', () => {
    // The originals carry the level inside the name; only the REWRITTEN rows
    // are deferred, so nothing already in the catalogue is affected.
    expect(isDeferredRow('Seafield School of English Limited', 'New Zealand Certificate in English Language (Academic) Level 5', 'Level 5')).toBe(false);
  });

  it('does not defer the same programme name at another institution', () => {
    expect(isDeferredRow('Bridge International College NZ Limited', 'New Zealand Certificate in English Language (Academic)', 'Level 4')).toBe(false);
  });

  it('defers exactly two rows and no more', () => {
    expect(DEFERRED_ROWS).toHaveLength(2);
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

describe('parseVerificationStatus — never claim more confidence than the source', () => {
  it('maps "Single-source" to NEEDS_RECHECK, not VERIFIED', () => {
    // 379 of 1,128 workbook rows lead with this. The import used to record them
    // all as VERIFIED, over-stating the confidence of a third of the catalogue.
    expect(parseVerificationStatus('Single-source (fee/IELTS from IDP only; official page did not render)')).toBe('NEEDS_RECHECK');
    expect(parseVerificationStatus('Single source')).toBe('NEEDS_RECHECK');
  });

  it('maps the two genuine-confirmation phrasings to VERIFIED', () => {
    expect(parseVerificationStatus('Verified (NZQF Level 9 confirmed on studyspy.ac.nz)')).toBe('VERIFIED');
    expect(parseVerificationStatus('Double-checked: live programme page + official fee schedule')).toBe('VERIFIED');
  });

  it('maps an explicit Unverified', () => {
    expect(parseVerificationStatus('Unverified — could not reach the site')).toBe('UNVERIFIED');
  });

  it('fails toward "look at this", never toward "trusted"', () => {
    expect(parseVerificationStatus('some wording nobody anticipated')).toBe('NEEDS_RECHECK');
  });

  it('blank stays null rather than becoming a claim', () => {
    expect(parseVerificationStatus(null)).toBeNull();
    expect(parseVerificationStatus('')).toBeNull();
    expect(parseVerificationStatus('n/a')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseVerificationStatus('SINGLE-SOURCE (…)')).toBe('NEEDS_RECHECK');
    expect(parseVerificationStatus('verified')).toBe('VERIFIED');
  });
});
