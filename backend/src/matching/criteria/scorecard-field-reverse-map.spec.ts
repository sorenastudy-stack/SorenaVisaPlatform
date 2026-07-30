// PR-RECS-1 (slice 1) — GOLDEN freeze for the /scorecard → MatchCriteria reverse-
// map (Impl A). Pins the exact, reviewed representative choices + the three
// deliberate empties, so any change to the mapping is a provable diff. The
// downstream fitScore is already frozen in matching.golden.spec.ts; this freezes
// the CRITERIA that feeds it.
import {
  Q16_TO_STUDYFIELD_KEY, reverseMapQ16, buildCriteriaFromScorecardAnswers,
} from './scorecard-field-reverse-map';

describe('GOLDEN — q16 → StudyField key reverse-map', () => {
  it('freezes every option → representative (1:1, ambiguous-broadest, and null gaps)', () => {
    expect(Q16_TO_STUDYFIELD_KEY).toEqual({
      'Information Technology & Computer Science': 'it_computer_science',
      Engineering: 'engineering',
      'Construction, Trades & Infrastructure': 'construction_trades',
      'Education & Teaching': 'education_teaching',
      'Agriculture & Primary Industries': 'agriculture',
      'Science & Environment': 'science_environment',
      'Aviation, Maritime & Transport': 'aviation_transport',
      'Media & Communication': 'media_communication',
      'Arts, Design & Creative Industries': 'arts_design',
      'Law, Politics & Government': 'law_government',
      'General / Interdisciplinary': 'general_interdisciplinary',
      // ambiguous → broadest representative
      'Healthcare & Medical': 'healthcare_medical',
      'Business & Management': 'business_management',
      'Hospitality, Tourism & Culinary': 'hospitality_culinary',
      // unresolvable → null (honest gap)
      'Military & Security': null,
      'Religious & Theological Studies': null,
      Other: null,
    });
  });

  it('unknown / empty option → null', () => {
    expect(reverseMapQ16('Something Not In The List')).toBeNull();
    expect(reverseMapQ16(undefined)).toBeNull();
    expect(reverseMapQ16('')).toBeNull();
  });
});

describe('GOLDEN — buildCriteriaFromScorecardAnswers (Impl A)', () => {
  const idByKey = { it_computer_science: 'sf-it', business_management: 'sf-biz', healthcare_medical: 'sf-health' };

  it('maps a clean answer set; the three lossy fields stay DELIBERATELY empty', () => {
    const criteria = buildCriteriaFromScorecardAnswers(
      {
        q16_field_main: 'Information Technology & Computer Science',
        q15_highest_qual: 'Bachelor',
        q17_gpa: 'Good (above average)',
        q22_english_score: 'IELTS 6 - 6.5',
        q43_city: 'Auckland',
      },
      idByKey,
      'IR',
    );
    expect(criteria).toEqual({
      qualificationFieldId: 'sf-it',
      preferredFieldIds: [],      // DELIBERATE empty
      desiredLevels: [],          // DELIBERATE empty
      currentHighestLevel: 'BACHELOR',
      gpaBand: 3.2,
      ieltsEquivalent: 6,
      tuitionBudgetNZD: undefined, // DELIBERATE undefined
      nationality: 'IR',
      locationPref: ['Auckland'],
      workWhileStudying: undefined,
    });
  });

  it('ambiguous "Business & Management" → the business_management representative', () => {
    const c = buildCriteriaFromScorecardAnswers({ q16_field_main: 'Business & Management' }, idByKey);
    expect(c.qualificationFieldId).toBe('sf-biz');
  });

  it('"Other" / unmapped field → null qualificationFieldId (no fabricated field)', () => {
    expect(buildCriteriaFromScorecardAnswers({ q16_field_main: 'Other' }, idByKey).qualificationFieldId).toBeNull();
    expect(buildCriteriaFromScorecardAnswers({ q16_field_main: 'Military & Security' }, idByKey).qualificationFieldId).toBeNull();
  });

  it('a mapped key with no seeded id → null (fail safe, not a crash)', () => {
    // healthcare_medical maps, but if the StudyField row is missing from idByKey:
    const c = buildCriteriaFromScorecardAnswers({ q16_field_main: 'Engineering' }, idByKey); // engineering not in idByKey
    expect(c.qualificationFieldId).toBeNull();
  });

  it('Flexible city → ["flexible"]; "No test taken" → undefined English', () => {
    const c = buildCriteriaFromScorecardAnswers(
      { q16_field_main: 'Business & Management', q43_city: 'Flexible', q22_english_score: 'No test taken' },
      idByKey,
    );
    expect(c.locationPref).toEqual(['flexible']);
    expect(c.ieltsEquivalent).toBeUndefined();
  });

  it('empty answers → all-empty criteria (no crash, no guesses)', () => {
    const c = buildCriteriaFromScorecardAnswers({}, idByKey);
    expect(c.qualificationFieldId).toBeNull();
    expect(c.preferredFieldIds).toEqual([]);
    expect(c.currentHighestLevel).toBeNull();
    expect(c.gpaBand).toBeUndefined();
    expect(c.locationPref).toBeUndefined();
  });
});
