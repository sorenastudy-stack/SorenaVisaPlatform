import { geocodeQueries, judgeCandidate, isInNewZealand, locationCandidates, cleanInstitutionName, type GeocodeCandidate } from './geocode.logic';

describe('locationCandidates — the stored city is free text, not a city', () => {
  it('pulls a street address out of the brackets and prefers it', () => {
    expect(locationCandidates('Auckland (99 Khyber Pass Road, Grafton, Auckland 1023)'))
      .toEqual({ address: '99 Khyber Pass Road, Grafton, Auckland 1023', city: 'Auckland' });
  });

  it('does NOT treat a parenthetical note as an address', () => {
    expect(locationCandidates('Invercargill (HyFlex option available)'))
      .toEqual({ address: null, city: 'Invercargill' });
    expect(locationCandidates('Auckland (City) and Christchurch'))
      .toEqual({ address: null, city: 'Auckland' });
  });

  it('takes the first campus from a list', () => {
    expect(locationCandidates('Dunedin; Auckland').city).toBe('Dunedin');
    expect(locationCandidates('Rotorua; Tauranga; Wider BOP/Other').city).toBe('Rotorua');
  });

  it('strips a trailing note after a dash', () => {
    expect(locationCandidates('Auckland (City Campus) - unconfirmed this session').city).toBe('Auckland');
  });

  it('keeps a non-city hint rather than inventing one', () => {
    // "Madras Street Campus" is not a city at all. The "Campus" suffix is
    // dropped (Nominatim knows streets, not "X Campus") and the remainder is
    // passed through — it is the only location hint the source gives, and
    // "Ara Institute of Canterbury, Madras Street, New Zealand" does resolve.
    expect(locationCandidates('Madras Street Campus').city).toBe('Madras Street');
  });

  it('handles a missing city', () => {
    expect(locationCandidates(null)).toEqual({ address: null, city: null });
  });

  // Multi-campus institutions list every campus, in whatever separator the
  // source used. First campus wins — one pin beats no pin.
  it('takes the first campus from a slash list', () => {
    expect(locationCandidates('Auckland / Christchurch / Tauranga').city).toBe('Auckland');
  });

  it('takes the first from an "or" list', () => {
    expect(locationCandidates('Auckland, Wellington, or Christchurch').city).toBe('Auckland');
  });

  it('drops a redundant ", New Zealand" suffix', () => {
    expect(locationCandidates('Huntly, New Zealand').city).toBe('Huntly');
  });

  it('reduces "Hamilton City Campus" to a place the geocoder knows', () => {
    expect(locationCandidates('Hamilton City Campus').city).toBe('Hamilton');
  });

  it('keeps a two-part place name usable', () => {
    // "Hastings, Hawke's Bay" → "Hastings" still geocodes correctly.
    expect(locationCandidates("Hastings, Hawke's Bay (Hastings Aerodrome, 1591 Maraekakaho Rd)").city).toBe('Hastings');
  });
});

describe('cleanInstitutionName', () => {
  it('drops trading-name and legal-entity suffixes', () => {
    expect(cleanInstitutionName('AIPA Auckland International Pilot Academy (trading name of North Shore Aero Club Incorporated)'))
      .toBe('AIPA Auckland International Pilot Academy');
    expect(cleanInstitutionName('AcademyEx Education Limited Partnership')).toBe('AcademyEx Education');
  });
});

describe('geocodeQueries — most specific first', () => {
  it('tries institution+city, then institution, then city', () => {
    expect(geocodeQueries('Ara Institute of Canterbury', 'Christchurch')).toEqual([
      'Ara Institute of Canterbury, Christchurch, New Zealand',
      'Ara Institute of Canterbury, New Zealand',
      'Christchurch, New Zealand',
    ]);
  });

  it('leads with a street address when the source has one', () => {
    const q = geocodeQueries('AcademyEx Education Limited Partnership', 'Auckland (99 Khyber Pass Road, Grafton, Auckland 1023)');
    expect(q[0]).toBe('99 Khyber Pass Road, Grafton, Auckland 1023, New Zealand');
    expect(q[q.length - 1]).toBe('Auckland, New Zealand'); // city stays the last resort
  });

  it('strips legal-entity noise the geocoder does not know', () => {
    const q = geocodeQueries('AIPA Auckland International Pilot Academy (trading name of North Shore Aero Club Incorporated)', null);
    expect(q[0]).toBe('AIPA Auckland International Pilot Academy, New Zealand');
  });

  it('puts the bare city LAST so it is judged as the city-level fallback', () => {
    const q = geocodeQueries('Some College', 'Hamilton');
    expect(q[q.length - 1]).toBe('Hamilton, New Zealand');
  });

  it('strips a trailing Limited/Ltd', () => {
    expect(geocodeQueries('International College of Auckland Limited', null)[0])
      .toBe('International College of Auckland, New Zealand');
  });

  it('also tries a bracketed acronym on its own', () => {
    expect(geocodeQueries('Southern Institute of Technology (SIT)', null))
      .toContain('SIT, New Zealand');
  });

  it('does not emit duplicates when there is no city', () => {
    const q = geocodeQueries('NorthTec', null);
    expect(new Set(q).size).toBe(q.length);
  });
});

describe('isInNewZealand', () => {
  it('accepts real NZ locations', () => {
    expect(isInNewZealand(-43.53, 172.63)).toBe(true);  // Christchurch
    expect(isInNewZealand(-36.85, 174.76)).toBe(true);  // Auckland
    expect(isInNewZealand(-46.90, 168.13)).toBe(true);  // Stewart Island
  });

  it('rejects the same-named places overseas', () => {
    expect(isInNewZealand(40.80, -96.68)).toBe(false);  // Lincoln, Nebraska
    expect(isInNewZealand(51.28, 1.08)).toBe(false);    // Canterbury, Kent
    expect(isInNewZealand(51.00, -3.22)).toBe(false);   // Wellington, Somerset
  });
});

describe('judgeCandidate — reject rather than guess', () => {
  const nz: GeocodeCandidate = { lat: -43.53, lon: 172.63, displayName: 'Ara Institute, Christchurch' };

  it('accepts an NZ result from the first query as a campus match', () => {
    expect(judgeCandidate(nz, 0, 3)).toMatchObject({ accepted: true, quality: 'campus' });
  });

  it('labels a middle-query match as institution-level', () => {
    expect(judgeCandidate(nz, 1, 3)).toMatchObject({ accepted: true, quality: 'institution' });
  });

  it('labels the last-query match as city-level, not campus', () => {
    // A city fallback is town-accurate only; mislabelling it would present a
    // pin in the middle of Christchurch as though it were the campus.
    expect(judgeCandidate(nz, 2, 3)).toMatchObject({ accepted: true, quality: 'city' });
  });

  it('refuses a confident-looking match in the wrong hemisphere', () => {
    const nebraska: GeocodeCandidate = { lat: 40.80, lon: -96.68, displayName: 'Lincoln, Nebraska, USA' };
    const d = judgeCandidate(nebraska, 0, 2);
    expect(d.accepted).toBe(false);
    expect(d.lat).toBeNull();
    expect(d.reason).toMatch(/outside New Zealand/);
  });

  it('refuses no-result and non-numeric coordinates', () => {
    expect(judgeCandidate(null, 0, 1).accepted).toBe(false);
    expect(judgeCandidate({ lat: NaN, lon: 172, displayName: 'x' }, 0, 1).accepted).toBe(false);
  });

  it('a single-query lookup is never treated as a city fallback', () => {
    expect(judgeCandidate(nz, 0, 1)).toMatchObject({ accepted: true, quality: 'campus' });
  });
});
