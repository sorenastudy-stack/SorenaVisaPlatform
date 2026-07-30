// PR-PHASE32 — Matching Engine core unit tests. Focus: the Q30 field-
// relatedness rule and the hard-filter's compliance guarantees (unapproved data
// never surfaces; a disallowed field is rejected even if it slipped into the
// applicant's preferences).
import {
  allowedFieldIds, levelMeets, passesHardFilter, rankRecommendations,
  type FieldNode, type RelationEdge, type MatchCriteria, type ProgrammeForMatch,
} from './matching.logic';

const FIELDS: FieldNode[] = [
  { id: 'mgmt', categoryAlwaysSelectable: true },   // Management & Business — always selectable
  { id: 'it', categoryAlwaysSelectable: false },
  { id: 'health', categoryAlwaysSelectable: false },
  { id: 'eng', categoryAlwaysSelectable: false },
  { id: 'arts', categoryAlwaysSelectable: false },
];
const RELATIONS: RelationEdge[] = [
  { sourceFieldId: 'eng', targetFieldId: 'it', approved: true },      // Engineering → IT (coherent, approved)
  { sourceFieldId: 'eng', targetFieldId: 'health', approved: false }, // pending → must NOT count
];

const baseCriteria: MatchCriteria = {
  qualificationFieldId: 'eng',
  preferredFieldIds: [],
  desiredLevels: [],
  currentHighestLevel: 'BACHELOR',
};

function prog(over: Partial<ProgrammeForMatch>): ProgrammeForMatch {
  return {
    id: 'p', approved: true, providerApproved: true, studyFieldIds: ['it'],
    level: 'BACHELOR', tuitionFeeNZD: 30000, intakeMonths: [2, 7], city: 'Auckland',
    req: { minQualificationLevel: 'BACHELOR', minGpa: null, englishOverallMin: 6.0 },
    ...over,
  };
}

describe('allowedFieldIds — Q30 progression rule', () => {
  it('includes the applicant\'s own field, approved relation targets, and always-selectable fields', () => {
    const a = allowedFieldIds('eng', FIELDS, RELATIONS);
    expect([...a].sort()).toEqual(['eng', 'it', 'mgmt']); // self + approved eng→it + Management
  });
  it('EXCLUDES targets of unapproved relations', () => {
    expect(allowedFieldIds('eng', FIELDS, RELATIONS).has('health')).toBe(false);
  });
  it('null/unmapped prior field (Other) → Management & Business only', () => {
    expect([...allowedFieldIds(null, FIELDS, RELATIONS)]).toEqual(['mgmt']);
  });
  it('a field with no outgoing edges → self + Management', () => {
    expect([...allowedFieldIds('it', FIELDS, RELATIONS)].sort()).toEqual(['it', 'mgmt']);
  });
});

describe('levelMeets', () => {
  it('passes when applicant level ≥ minimum', () => {
    expect(levelMeets('MASTER', 'BACHELOR')).toBe(true);
    expect(levelMeets('BACHELOR', 'BACHELOR')).toBe(true);
  });
  it('fails when below minimum; no minimum always passes; unknown fails closed', () => {
    expect(levelMeets('DIPLOMA', 'BACHELOR')).toBe(false);
    expect(levelMeets('DIPLOMA', null)).toBe(true);
    expect(levelMeets(null, 'BACHELOR')).toBe(false);
  });
});

describe('passesHardFilter — compliance guarantees', () => {
  const allowed = allowedFieldIds('eng', FIELDS, RELATIONS); // {eng, it, mgmt}

  it('never surfaces an unapproved programme', () => {
    expect(passesHardFilter(prog({ approved: false }), baseCriteria, allowed)).toBe(false);
  });
  it('never surfaces a programme from an unapproved provider', () => {
    expect(passesHardFilter(prog({ providerApproved: false }), baseCriteria, allowed)).toBe(false);
  });
  it('REJECTS a disallowed field even if the applicant put it in preferences (bypass-proof)', () => {
    const tampered: MatchCriteria = { ...baseCriteria, preferredFieldIds: ['health'] };
    const p = prog({ studyFieldIds: ['health'] }); // health not in allowed for an eng background
    expect(passesHardFilter(p, tampered, allowed)).toBe(false);
  });
  it('accepts an allowed + preferred field', () => {
    const c: MatchCriteria = { ...baseCriteria, preferredFieldIds: ['it'] };
    expect(passesHardFilter(prog({ studyFieldIds: ['it'] }), c, allowed)).toBe(true);
  });
  it('always-selectable Management field passes regardless of prior field', () => {
    expect(passesHardFilter(prog({ studyFieldIds: ['mgmt'] }), baseCriteria, allowed)).toBe(true);
  });
  it('enforces level / GPA / English / budget gates', () => {
    expect(passesHardFilter(prog({ req: { minQualificationLevel: 'MASTER' } }), baseCriteria, allowed)).toBe(false); // needs Master, has Bachelor
    expect(passesHardFilter(prog({ req: { minGpa: 3.5 } }), { ...baseCriteria, gpaBand: 3.0 }, allowed)).toBe(false);
    expect(passesHardFilter(prog({ req: { englishOverallMin: 7.0 } }), { ...baseCriteria, ieltsEquivalent: 6.0 }, allowed)).toBe(false);
    expect(passesHardFilter(prog({ tuitionFeeNZD: 50000 }), { ...baseCriteria, tuitionBudgetNZD: 40000 }, allowed)).toBe(false);
  });
});

describe('rankRecommendations — filter + rank', () => {
  it('excludes disallowed-field and unapproved programmes, ranks the rest by fitScore', () => {
    const c: MatchCriteria = { ...baseCriteria, preferredFieldIds: ['it', 'mgmt'], tuitionBudgetNZD: 40000, ieltsEquivalent: 7.0, nationality: 'IR' };
    const programmes: ProgrammeForMatch[] = [
      prog({ id: 'it-cheap-scholarship', studyFieldIds: ['it'], tuitionFeeNZD: 20000, rankingScore: 80, scholarshipsForNationality: [{ name: 'Iran Merit', nationality: 'IR' }] }),
      prog({ id: 'mgmt-ok', studyFieldIds: ['mgmt'], tuitionFeeNZD: 38000, rankingScore: 50 }),
      prog({ id: 'health-disallowed', studyFieldIds: ['health'] }),         // Q30: excluded
      prog({ id: 'it-unapproved', studyFieldIds: ['it'], approved: false }), // excluded
    ];
    const recs = rankRecommendations(programmes, c, FIELDS, RELATIONS);
    const ids = recs.map((r) => r.programmeId);
    expect(ids).not.toContain('health-disallowed');
    expect(ids).not.toContain('it-unapproved');
    expect(ids[0]).toBe('it-cheap-scholarship'); // best: preferred field + scholarship + cheap + high ranking
    expect(recs[0].fitScore).toBeGreaterThan(recs[1].fitScore);
    expect(recs[0].why.some((d) => d.dim === 'scholarship')).toBe(true);
  });
});
