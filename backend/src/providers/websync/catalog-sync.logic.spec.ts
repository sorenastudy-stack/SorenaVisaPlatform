// PR-CATALOG-2 — golden battery for the sweep's pure orchestration logic. Frozen before
// wiring. Focus: (1) a diff only fires on fields the extractor actually found; (2) dedupe
// keys line up between stored programmes and candidates; (3) the confidence + cap guards
// keep the queue bounded and count (never silently drop) the overflow.
import {
  diffMonitoredFields,
  sameChange,
  changeProposalToUpdate,
  storedNatKey,
  candidateNatKey,
  routeCandidates,
  type StoredProgrammeFields,
} from './catalog-sync.logic';
import type { NormalizedCandidate } from './programme-extract.logic';

function cand(over: Partial<NormalizedCandidate> & { programme?: Record<string, unknown> } = {}): NormalizedCandidate {
  const { programme, ...rest } = over;
  return {
    proposedData: {
      programme: { tuitionFeeNZD: 30000, nzqfLevel: 'LEVEL_7', durationMonths: 36, campusCity: 'Auckland', qualificationType: "Bachelor's Degree", ...(programme ?? {}) } as any,
      studyFieldKey: 'it_computer_science',
      studyFieldUnmapped: false,
      intakes: [],
    },
    nameNormalized: 'bachelor of computing',
    nzqfLevel: 'LEVEL_7',
    campusCity: 'Auckland',
    detectedFields: ['name', 'tuitionFeeNZD', 'nzqfLevel', 'duration', 'campusCity', 'qualificationType'],
    confidence: 0.9,
    meetsThreshold: true,
    ...rest,
  };
}

describe('diffMonitoredFields — Pass A change detection', () => {
  const stored: StoredProgrammeFields = { tuitionFeeNZD: 30000, nzqfLevel: 'LEVEL_7', durationMonths: 36, campusCity: 'Auckland', qualificationType: "Bachelor's Degree" };

  it('returns {} when nothing changed', () => {
    expect(diffMonitoredFields(stored, cand())).toEqual({});
  });

  it('detects a fee change', () => {
    const c = cand({ programme: { tuitionFeeNZD: 34000 } });
    expect(diffMonitoredFields(stored, c)).toEqual({ tuitionFeeNZD: { from: 30000, to: 34000 } });
  });

  it('does NOT propose a change for a field the extractor did not find (no false null)', () => {
    // fee absent from the page → 'tuitionFeeNZD' not in detectedFields; programme carries null.
    const c = cand({ programme: { tuitionFeeNZD: null }, detectedFields: ['name', 'nzqfLevel', 'campusCity'] });
    expect(diffMonitoredFields(stored, c)).toEqual({}); // fee skipped, not proposed as "→ null"
  });

  it('detects multiple changed fields at once', () => {
    const c = cand({ programme: { tuitionFeeNZD: 34000, campusCity: 'Wellington' } });
    expect(diffMonitoredFields(stored, c)).toEqual({
      tuitionFeeNZD: { from: 30000, to: 34000 },
      campusCity: { from: 'Auckland', to: 'Wellington' },
    });
  });
});

describe('sameChange / changeProposalToUpdate', () => {
  it('treats identical change sets as equal regardless of key order', () => {
    expect(sameChange({ a: { from: 1, to: 2 }, b: { from: 3, to: 4 } }, { b: { from: 9, to: 4 }, a: { from: 8, to: 2 } })).toBe(true);
  });
  it('differs when a target value moved', () => {
    expect(sameChange({ a: { from: 1, to: 2 } }, { a: { from: 1, to: 5 } })).toBe(false);
  });
  it('builds a prisma update payload of {field: to}', () => {
    expect(changeProposalToUpdate({ tuitionFeeNZD: { from: 30000, to: 34000 } })).toEqual({ tuitionFeeNZD: 34000 });
  });
});

describe('dedupe keys line up between stored programmes and candidates', () => {
  it('a stored programme and an equivalent candidate produce the same key', () => {
    expect(storedNatKey('Bachelor of Computing', 'LEVEL_7', 'Auckland')).toBe(candidateNatKey(cand()));
  });
  it('differ by level or campus', () => {
    expect(storedNatKey('Bachelor of Computing', 'LEVEL_8', 'Auckland')).not.toBe(candidateNatKey(cand()));
    expect(storedNatKey('Bachelor of Computing', 'LEVEL_7', 'Wellington')).not.toBe(candidateNatKey(cand()));
  });
});

describe('routeCandidates — confidence + cap guards', () => {
  const mk = (conf: number, meets: boolean, name: string) => cand({ confidence: conf, meetsThreshold: meets, nameNormalized: name });

  it('surfaces above-threshold candidates highest-confidence-first, up to the cap', () => {
    const r = routeCandidates([mk(0.7, true, 'a'), mk(0.95, true, 'b'), mk(0.8, true, 'c')], 2);
    expect(r.surfaced.map((c) => c.nameNormalized)).toEqual(['b', 'c']); // top 2 by confidence
    expect(r.cappedCount).toBe(1); // the 0.7 one is counted, not surfaced
    expect(r.lowConfidenceCount).toBe(0);
  });

  it('keeps below-threshold candidates out of the queue and counts them', () => {
    const r = routeCandidates([mk(0.9, true, 'a'), mk(0.3, false, 'b'), mk(0.2, false, 'c')], 25);
    expect(r.surfaced.map((c) => c.nameNormalized)).toEqual(['a']);
    expect(r.lowConfidenceCount).toBe(2);
    expect(r.cappedCount).toBe(0);
  });
});
