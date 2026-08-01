// PR-OWNER-1 (slice b) — GOLDEN fit-score battery.
//
// Freezes the EXACT softScore / rankRecommendations output of the matcher so any
// change to the scoring formula is a provable, intentional diff (mirrors
// scoring.spec.ts for the assessment engine). Committed BEFORE the institution-
// type weighting change so the diff on this file IS the review artifact.
//
// These fixtures set NO institutionType and pass NO weighting config, so they
// pin the legacy 5-factor behavior. When slice (b) adds the 6th (institution)
// component, this no-config path MUST stay byte-identical — the institution term
// only engages when a CountryExecutionConfig weighting is supplied. New fixtures
// with institution types + weighting are added alongside (not replacing) these.
import {
  softScore, rankRecommendations, institutionFactor,
  type MatchCriteria, type ProgrammeForMatch, type FieldNode, type RelationEdge,
} from './matching.logic';

const FIELDS: FieldNode[] = [
  { id: 'mgmt', categoryAlwaysSelectable: true },
  { id: 'it', categoryAlwaysSelectable: false },
  { id: 'eng', categoryAlwaysSelectable: false },
];
const RELATIONS: RelationEdge[] = [{ sourceFieldId: 'eng', targetFieldId: 'it', approved: true }];

function prog(over: Partial<ProgrammeForMatch>): ProgrammeForMatch {
  return {
    id: 'p', approved: true, providerApproved: true, studyFieldIds: ['it'],
    level: 'BACHELOR', tuitionFeeNZD: 30000, intakeMonths: [2, 7], city: 'Auckland',
    req: null, ...over,
  };
}

const C: MatchCriteria = {
  qualificationFieldId: 'eng', preferredFieldIds: ['it', 'mgmt'], desiredLevels: [],
  currentHighestLevel: 'BACHELOR', tuitionBudgetNZD: 40000, ieltsEquivalent: 7.0, nationality: 'IR',
};

const P = {
  itCheapScholarship: prog({ id: 'it-cheap-scholarship', studyFieldIds: ['it'], tuitionFeeNZD: 20000, rankingScore: 80, scholarshipsForNationality: [{ name: 'Iran Merit', nationality: 'IR' }] }),
  mgmtOk: prog({ id: 'mgmt-ok', studyFieldIds: ['mgmt'], tuitionFeeNZD: 38000, rankingScore: 50 }),
  itPlain: prog({ id: 'it-plain', studyFieldIds: ['it'], tuitionFeeNZD: 30000, rankingScore: null }),
  itHamilton: prog({ id: 'it-noloc-pref', studyFieldIds: ['it'], tuitionFeeNZD: 30000, rankingScore: 60, city: 'Hamilton' }),
};

describe('GOLDEN — softScore (legacy 5-factor, no institution weighting)', () => {
  it('freezes exact per-factor composite scores', () => {
    expect(softScore(P.itCheapScholarship, C)).toBe(0.825); // preferred + scholarship + cheap + ranking 80
    expect(softScore(P.mgmtOk, C)).toBe(0.547);
    expect(softScore(P.itPlain, C)).toBe(0.558);            // ranking null → neutral 0.4
    expect(softScore(P.itHamilton, C)).toBe(0.597);
  });

  it('freezes the location factor (preference hit vs miss)', () => {
    const withLoc: MatchCriteria = { ...C, locationPref: ['Auckland'] };
    expect(softScore(P.itPlain, withLoc)).toBe(0.618);   // city Auckland ∈ pref → full location
    expect(softScore(P.itHamilton, withLoc)).toBe(0.507); // city Hamilton ∉ pref → zero location
  });
});

describe('GOLDEN — rankRecommendations order + fitScores (legacy)', () => {
  it('freezes the ranked order and every fitScore', () => {
    const recs = rankRecommendations([P.itCheapScholarship, P.mgmtOk, P.itPlain, P.itHamilton], C, FIELDS, RELATIONS);
    expect(recs.map((r) => [r.programmeId, r.fitScore])).toEqual([
      ['it-cheap-scholarship', 0.825],
      ['it-noloc-pref', 0.597],
      ['it-plain', 0.558],
      ['mgmt-ok', 0.547],
    ]);
  });
});

// ── PR-OWNER-1 (slice b) — the NEW 6th (institution) component ────────────────
// When a per-country institutionTypeWeighting is supplied, institution type is a
// 6th independent, additive component; the other five are scaled by (1 - 0.15).
const W = { PTE: 0.4, ITP: 0.35, UNIVERSITY: 0.25 }; // NZ seed weighting

describe('GOLDEN — institutionFactor (weight normalised so top type = 1.0)', () => {
  it('maps each type to its normalised factor; un-typed/unknown → neutral 0.5', () => {
    expect(institutionFactor('PTE', W)).toBe(1);          // top weight → 1.0
    expect(institutionFactor('ITP', W)).toBeCloseTo(0.875, 5);
    expect(institutionFactor('UNIVERSITY', W)).toBe(0.625);
    expect(institutionFactor(null, W)).toBe(0.5);         // un-typed → neutral
    expect(institutionFactor('ITP', {})).toBe(0.5);       // empty weighting → neutral
  });
});

describe('GOLDEN — softScore with institution weighting (6-factor)', () => {
  // Same base programme (ranking 60, tuition 30k, preferred field 'it'); ONLY the
  // institution type varies, isolating the 6th component. Criteria has no
  // scholarship/location so those factors are constant.
  const CFG_C: MatchCriteria = { qualificationFieldId: 'eng', preferredFieldIds: ['it'], desiredLevels: [], currentHighestLevel: 'BACHELOR', tuitionBudgetNZD: 40000, ieltsEquivalent: 7.0 };
  const base = (t: 'UNIVERSITY' | 'ITP' | 'PTE' | null) => prog({ id: `x-${t}`, institutionType: t, rankingScore: 60 });
  it('freezes exact 6-factor scores by institution type', () => {
    expect(softScore(base('UNIVERSITY'), CFG_C, W)).toBe(0.602);
    expect(softScore(base('ITP'), CFG_C, W)).toBe(0.639);
    expect(softScore(base('PTE'), CFG_C, W)).toBe(0.658);
    expect(softScore(base(null), CFG_C, W)).toBe(0.583); // un-typed → neutral institution factor
  });
  it('with the SAME inputs but NO weighting, stays on the legacy path (0.597)', () => {
    expect(softScore(base('PTE'), CFG_C)).toBe(0.597);
    expect(softScore(base(null), CFG_C)).toBe(0.597);
  });
  it('reorders so a strongly-weighted type can outrank a higher-ranked weaker type', () => {
    const FIELDS2: FieldNode[] = [{ id: 'it', categoryAlwaysSelectable: false }, { id: 'eng', categoryAlwaysSelectable: false }];
    const RELS2: RelationEdge[] = [{ sourceFieldId: 'eng', targetFieldId: 'it', approved: true }];
    const progs = [
      prog({ id: 'uni-a', institutionType: 'UNIVERSITY', rankingScore: 90 }),
      prog({ id: 'itp-a', institutionType: 'ITP', rankingScore: 65 }),
      prog({ id: 'pte-a', institutionType: 'PTE', rankingScore: 60 }),
    ];
    const recs = rankRecommendations(progs, CFG_C, FIELDS2, RELS2, W);
    expect(recs.map((r) => [r.programmeId, r.fitScore])).toEqual([
      ['pte-a', 0.658], // PTE weighting lifts it above the higher-ranked University
      ['uni-a', 0.653],
      ['itp-a', 0.648],
    ]);
  });
});
