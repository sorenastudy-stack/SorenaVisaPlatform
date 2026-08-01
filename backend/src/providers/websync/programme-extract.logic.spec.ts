// PR-CATALOG-2 — golden battery for the pure extraction logic. Frozen before wiring the
// crawl. Focus: (1) junk pages become null, never a candidate; (2) the AI's confidence
// claim is capped by how much it actually found, so thin pages can't reach the main queue;
// (3) discovered programmes normalise through the SAME importer path as an Excel row;
// (4) the reply parser is tolerant and never throws.
import {
  normalizeCandidate,
  parseExtractionResponse,
  normalizeName,
  extractedToRow,
  CONFIDENCE_THRESHOLD,
  type ExtractedProgramme,
  type ExtractCtx,
} from './programme-extract.logic';

const ctx: ExtractCtx = { providerId: 'prov1', sourceUrl: 'https://uni.ac.nz/prog/bcs' };

const full: ExtractedProgramme = {
  name: 'Bachelor of Computing',
  qualificationType: "Bachelor's Degree",
  nzqfLevel: 7,
  subjectArea: 'Computing',
  duration: '3 years',
  deliveryMode: 'On-campus',
  campusCity: 'Auckland',
  tuitionFeeNZD: 32000,
  feeBasis: 'per year',
  feeYear: 2027,
  studentVisaSuitable: true,
  intakes: 'February, July',
  confidence: 0.9,
  isProgramme: true,
};

describe('normalizeCandidate — reject non-candidates', () => {
  it('returns null when the page has no programme name', () => {
    expect(normalizeCandidate({ ...full, name: null }, ctx)).toBeNull();
    expect(normalizeCandidate({ ...full, name: '   ' }, ctx)).toBeNull();
  });

  it('returns null when the AI flags the page as not a programme', () => {
    expect(normalizeCandidate({ ...full, isProgramme: false }, ctx)).toBeNull();
  });
});

describe('normalizeCandidate — full extraction normalises via the importer path', () => {
  const c = normalizeCandidate(full, ctx)!;

  it('produces a candidate through rowToProgrammeData with web-check provenance', () => {
    expect(c).not.toBeNull();
    expect(c.proposedData.programme.name).toBe('Bachelor of Computing');
    expect(c.proposedData.programme.nzqfLevel).toBe('LEVEL_7');
    expect(c.proposedData.programme.level).toBe('BACHELOR');
    expect(c.proposedData.programme.tuitionFeeNZD).toBe(32000);
    expect(c.proposedData.programme.durationMonths).toBe(36);
    expect(c.proposedData.programme.source).toBe('AUTOMATED_WEB_CHECK');
    expect(c.proposedData.programme.sourceRef).toBe(ctx.sourceUrl);
    expect(c.proposedData.programme.programmeUrl).toBe(ctx.sourceUrl);
    expect(c.proposedData.programme.reviewStatus).toBe('PENDING');
    expect(c.proposedData.programme.isActive).toBe(false);
  });

  it('maps the study field and parses intakes', () => {
    expect(c.proposedData.studyFieldKey).toBe('it_computer_science');
    expect(c.proposedData.studyFieldUnmapped).toBe(false);
    expect(c.proposedData.intakes.map((i) => i.label)).toEqual(['February', 'July']);
  });

  it('emits the dedupe natural key', () => {
    expect(c.nameNormalized).toBe('bachelor of computing');
    expect(c.nzqfLevel).toBe('LEVEL_7');
    expect(c.campusCity).toBe('Auckland');
  });

  it('keeps high confidence and reaches the main queue when coverage is full', () => {
    expect(c.confidence).toBe(0.9);
    expect(c.meetsThreshold).toBe(true);
    expect(c.detectedFields).toContain('name');
    expect(c.detectedFields).toContain('tuitionFeeNZD');
  });
});

describe('normalizeCandidate — coverage caps the confidence claim', () => {
  it('caps an inflated AI confidence by the fraction of core fields actually found', () => {
    // Only name + 1 of 6 core fields present, but the model claims 0.95.
    const thin: ExtractedProgramme = {
      name: 'Certificate in Something',
      qualificationType: 'Certificate',
      nzqfLevel: null,
      subjectArea: null,
      duration: null,
      campusCity: null,
      tuitionFeeNZD: null,
      confidence: 0.95,
      isProgramme: true,
    };
    const c = normalizeCandidate(thin, ctx)!;
    // coverage = 1/6 ≈ 0.17 → confidence capped there, well below threshold.
    expect(c.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
    expect(c.confidence).toBeCloseTo(0.17, 2);
    expect(c.meetsThreshold).toBe(false);
  });

  it('defaults a missing AI confidence to 0.5 before capping', () => {
    const noConf: ExtractedProgramme = { ...full, confidence: null };
    const c = normalizeCandidate(noConf, ctx)!;
    // full coverage (1.0) but AI gave no number → min(0.5, 1.0) = 0.5.
    expect(c.confidence).toBe(0.5);
  });
});

describe('normalizeName — deterministic dedupe key', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  Bachelor of  Computing (Hons)!! ')).toBe('bachelor of computing hons');
    expect(normalizeName('Bachelor of Computing')).toBe(normalizeName('BACHELOR   of computing'));
  });
});

describe('parseExtractionResponse — tolerant, never throws', () => {
  it('parses a bare object into a one-element array', () => {
    expect(parseExtractionResponse('{"name":"X"}')).toHaveLength(1);
  });
  it('parses a bare array', () => {
    expect(parseExtractionResponse('[{"name":"A"},{"name":"B"}]')).toHaveLength(2);
  });
  it('unwraps a ```json fenced block', () => {
    expect(parseExtractionResponse('```json\n[{"name":"A"}]\n```')).toHaveLength(1);
  });
  it('unwraps a { "programmes": [...] } object', () => {
    expect(parseExtractionResponse('{"programmes":[{"name":"A"},{"name":"B"}]}')).toHaveLength(2);
  });
  it('salvages JSON embedded in prose', () => {
    expect(parseExtractionResponse('Here you go:\n{"name":"A"}\nHope that helps')).toHaveLength(1);
  });
  it('returns [] on empty or unparseable input', () => {
    expect(parseExtractionResponse('')).toEqual([]);
    expect(parseExtractionResponse('not json at all')).toEqual([]);
    expect(parseExtractionResponse('```json\n{bad json}\n```')).toEqual([]);
  });
});

describe('extractedToRow — importer column keys', () => {
  it('uses the exact spreadsheet header keys rowToProgrammeData reads', () => {
    const row = extractedToRow(full);
    expect(row['Programme/Qualification']).toBe('Bachelor of Computing');
    expect(row['NZQF Level']).toBe(7);
    expect(row['Tuition Fee (NZD)']).toBe(32000);
  });
});
