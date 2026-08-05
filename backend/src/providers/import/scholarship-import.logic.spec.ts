import {
  detectCountry,
  mapColumns,
  parseAmount,
  isSectionHeader,
  parseScholarshipMatrix,
  normaliseKey,
} from './scholarship-import.logic';

describe('detectCountry — automatic, no manual code mapping', () => {
  it.each([
    ['Iran', 'IR'],
    ['IRAN', 'IR'],
    ['Iranian', 'IR'],
    ['Iran (Islamic Republic of)', 'IR'],
    ['Islamic Republic of Iran', 'IR'],
    ['Sri Lanka', 'LK'],
    ['Sri Lankan', 'LK'],
    ['Viet Nam', 'VN'],
    ['Vietnamese', 'VN'],
    ['PRC', 'CN'],
    ['UAE', 'AE'],
    ['South Korea', 'KR'],
    ['Republic of Korea', 'KR'],
    ['Philippines', 'PH'],
    ['Filipino', 'PH'],
  ])('detects %s → %s', (input, code) => {
    expect(detectCountry(input)).toMatchObject({ code, confidence: 'exact' });
  });

  it('strips filler words used in real sheets', () => {
    expect(detectCountry('Iranian Students')).toMatchObject({ code: 'IR', confidence: 'exact' });
    expect(detectCountry('Scholarships for students from Nepal')).toMatchObject({ code: 'NP' });
    expect(detectCountry('INDIA - nationals only')).toMatchObject({ code: 'IN' });
  });

  it('SUGGESTS a near-miss rather than guessing it', () => {
    const m = detectCountry('Vietnnam'); // typo
    expect(m.code).toBeNull();
    expect(m.confidence).toBe('near');
    expect(m.suggestion).toBe('vietnam');
  });

  it('returns none for genuinely unknown text', () => {
    expect(detectCountry('Engineering Faculty')).toMatchObject({ code: null, confidence: 'none' });
  });

  it('does not match short codes inside unrelated words', () => {
    // "us" must not fire inside "Business"
    expect(detectCountry('Business School Award').code).toBeNull();
  });

  it('normalises accents and punctuation', () => {
    expect(normaliseKey('Türkiye')).toBe('turkiye');
    expect(detectCountry('Türkiye')).toMatchObject({ code: 'TR' });
  });
});

describe('mapColumns — forgiving about naming and order', () => {
  it('maps a conventional header row', () => {
    const c = mapColumns(['Country', 'Scholarship Name', 'Amount (NZD)', 'Level', 'Eligibility']);
    expect(c).toMatchObject({ country: 0, name: 1, amount: 2, level: 3, notes: 4 });
  });

  it('maps reordered and differently-worded headers', () => {
    const c = mapColumns(['Award Value', 'Nationality', 'Award Name', 'Conditions']);
    expect(c).toMatchObject({ amount: 0, country: 1, name: 2, notes: 3 });
  });

  it('prefers the more specific header when two could match', () => {
    const c = mapColumns(['Scholarship Name', 'Scholarship Value']);
    expect(c.name).toBe(0);
    expect(c.amount).toBe(1);
  });
});

describe('parseAmount', () => {
  it('parses currency-formatted fixed amounts', () => {
    expect(parseAmount('NZ$3,000')).toEqual({ amountType: 'FIXED', amountValue: 3000 });
    expect(parseAmount('5000')).toEqual({ amountType: 'FIXED', amountValue: 5000 });
    expect(parseAmount('up to 2,500')).toEqual({ amountType: 'FIXED', amountValue: 2500 });
  });

  it('parses percentages', () => {
    expect(parseAmount('20%')).toEqual({ amountType: 'PERCENTAGE', amountValue: 20 });
    expect(parseAmount('15', 'Percentage')).toEqual({ amountType: 'PERCENTAGE', amountValue: 15 });
  });

  it('rejects nonsense rather than inventing a number', () => {
    expect(parseAmount('TBC')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('250%')).toBeNull();
  });
});

describe('isSectionHeader', () => {
  it('treats a lone country cell as a section header', () => {
    expect(isSectionHeader(['Iran', null, null])).toMatchObject({ code: 'IR' });
  });

  it('does not treat a full data row as a header', () => {
    expect(isSectionHeader(['Iran', 'Merit Award', '3000'])).toBeNull();
  });

  it('does not treat a lone non-country cell as a header', () => {
    expect(isSectionHeader(['Notes below', null])).toBeNull();
  });
});

describe('parseScholarshipMatrix — layout A: country column per row', () => {
  const matrix = [
    ['Country', 'Scholarship Name', 'Amount', 'Level', 'Eligibility'],
    ['Iran', 'Iran Merit Award', 'NZ$3,000', 'MASTERS', 'GPA 3.0+'],
    ['Iran', 'Faculty Bursary', '1500', null, null],
    ['India', 'India Excellence', '2,000', null, 'First year only'],
  ];

  it('parses every row and groups the tally by country', () => {
    const r = parseScholarshipMatrix(matrix);
    expect(r.rows).toHaveLength(3);
    expect(r.needsReview).toHaveLength(0);
    expect(r.detected).toEqual([
      { countryCode: 'IR', countryLabel: 'Iran', count: 2 },
      { countryCode: 'IN', countryLabel: 'India', count: 1 },
    ]);
  });

  it('carries level and notes through when present', () => {
    const r = parseScholarshipMatrix(matrix);
    expect(r.rows[0]).toMatchObject({
      countryCode: 'IR',
      name: 'Iran Merit Award',
      amountType: 'FIXED',
      amountValue: 3000,
      level: 'MASTERS',
      eligibilityNotes: 'GPA 3.0+',
      sourceRow: 2,
    });
  });
});

describe('parseScholarshipMatrix — layout B: country section headers', () => {
  const matrix = [
    ['University of Example — Scholarships 2027'], // preamble, ignored
    ['Scholarship', 'Value', 'Eligibility'],
    ['Iran'], // section header
    ['Iran Merit Award', '3000', 'GPA 3.0+'],
    ['Iran Bursary', '1500', null],
    ['Sri Lanka'], // section header
    ['Colombo Award', '20%', 'Full fee students'],
  ];

  it('applies the section country to the rows beneath it', () => {
    const r = parseScholarshipMatrix(matrix);
    expect(r.rows.map((x) => [x.countryCode, x.name])).toEqual([
      ['IR', 'Iran Merit Award'],
      ['IR', 'Iran Bursary'],
      ['LK', 'Colombo Award'],
    ]);
  });

  it('handles a percentage inside a section', () => {
    const r = parseScholarshipMatrix(matrix);
    expect(r.rows[2]).toMatchObject({ amountType: 'PERCENTAGE', amountValue: 20 });
  });
});

describe('parseScholarshipMatrix — forgiving but never silent', () => {
  it('flags an unrecognised country spelling WITH a suggestion, and does not import it', () => {
    const r = parseScholarshipMatrix([
      ['Country', 'Scholarship', 'Amount'],
      ['Vietnnam', 'Hanoi Award', '2000'],
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.needsReview[0]).toMatchObject({
      sourceRow: 2,
      reason: 'UNRECOGNISED_COUNTRY',
      raw: 'Vietnnam',
      suggestion: 'vietnam',
    });
  });

  it('flags a row with no country context', () => {
    const r = parseScholarshipMatrix([
      ['Scholarship', 'Amount'],
      ['Orphan Award', '1000'],
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.needsReview[0]).toMatchObject({ reason: 'NO_COUNTRY_CONTEXT' });
  });

  it('flags an unparseable amount instead of importing a 0', () => {
    const r = parseScholarshipMatrix([
      ['Country', 'Scholarship', 'Amount'],
      ['Iran', 'Mystery Award', 'TBC'],
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.needsReview[0]).toMatchObject({ reason: 'MISSING_OR_INVALID_AMOUNT', raw: 'TBC' });
  });

  it('keeps good rows and quarantines only the bad ones', () => {
    const r = parseScholarshipMatrix([
      ['Country', 'Scholarship', 'Amount'],
      ['Iran', 'Good One', '3000'],
      ['Atlantis', 'Bad Country', '1000'],
      ['India', 'Also Good', '2000'],
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.needsReview).toHaveLength(1);
    expect(r.needsReview[0].sourceRow).toBe(3);
  });

  it('reports a sheet with no usable header row rather than throwing', () => {
    const r = parseScholarshipMatrix([['just'], ['some'], ['notes']]);
    expect(r.rows).toHaveLength(0);
    expect(r.needsReview).toHaveLength(1);
  });
});
