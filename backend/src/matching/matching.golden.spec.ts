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
  softScore, rankRecommendations,
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
