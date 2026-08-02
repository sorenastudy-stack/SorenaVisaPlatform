import {
  buildFactualFrame,
  parseAiSopParts,
  assembleSop,
  parseGateVerdicts,
  evaluateGateEnforcement,
  SOP_GATE_KEYS,
  type SopSource,
  type AiSopParts,
  type SopGateResults,
} from './sop-content.logic';

const SOURCE: SopSource = {
  contact: { fullName: 'Ava Sharma', country: 'India' },
  application: {
    highestQualification: 'BACHELORS',
    citizenship: 'India',
    countryOfBirth: 'India',
    englishTestName: 'IELTS 6.5',
  },
  education: [
    { institutionName: 'Delhi University', qualificationLevel: 'BACHELORS', fieldOfStudy: 'Computer Science', country: 'India', startYear: 2016, endYear: 2020, completed: true },
  ],
  employment: [
    { employerName: 'Infosys', roleTitle: 'Software Engineer', organisationField: 'IT Services', countryOfWork: 'India', startYear: 2020, endYear: 2023, isCurrent: false, dutiesText: 'Backend APIs' },
    { employerName: 'TCS', roleTitle: 'Senior Engineer', organisationField: 'IT Services', countryOfWork: 'India', startYear: 2023, endYear: null, isCurrent: true, dutiesText: 'Team lead' },
  ],
  target: {
    programmeName: 'Master of Information Technology',
    providerName: 'University of Auckland',
    field: 'Information Technology',
    level: 'MASTERS',
    intakeMonth: 2,
    intakeYear: 2027,
  },
};

const AI_PARTS: AiSopParts = {
  intro: 'I am a software engineer from India seeking to advance my career.',
  careerPlan: 'I intend to return to India to lead a fintech engineering team within five years.',
  whyNewZealand: "New Zealand's strong data-privacy regime and its ICT skills focus fit my goals.",
  whyThisInstitution: 'The University of Auckland Master of Information Technology offers a specialisation I need.',
  homeTies: 'My family business and elderly parents in Delhi anchor my return to India.',
  conclusion: 'I am committed to completing my studies and returning home.',
};

const PASSING_VERDICTS = JSON.stringify({
  careerPlan: { pass: true, reason: 'Specific role and timeline.' },
  nzReasoning: { pass: true, reason: 'NZ-specific reasons given.' },
  homeTies: { pass: true, reason: 'Concrete family and business ties.' },
});

describe('buildFactualFrame — deterministic factual frame', () => {
  it('derives every frame field from verified source rows', () => {
    const f = buildFactualFrame(SOURCE);
    expect(f.applicantName).toBe('Ava Sharma');
    expect(f.homeCountry).toBe('India');
    expect(f.highestQualification).toBe("Bachelor's degree"); // labeled
    expect(f.englishTest).toBe('IELTS 6.5');
    expect(f.target).toEqual({
      programme: 'Master of Information Technology',
      provider: 'University of Auckland',
      field: 'Information Technology',
      level: 'MASTERS',
      intake: 'February 2027',
    });
  });

  it('current role prefers the isCurrent employment row', () => {
    expect(buildFactualFrame(SOURCE).currentRole).toBe('Senior Engineer at TCS');
  });

  it('falls back to the latest role by startYear when none is marked current', () => {
    const noCurrent: SopSource = {
      ...SOURCE,
      employment: SOURCE.employment.map((e) => ({ ...e, isCurrent: false })),
    };
    expect(buildFactualFrame(noCurrent).currentRole).toBe('Senior Engineer at TCS');
  });

  it('handles an applicant with no employment history', () => {
    expect(buildFactualFrame({ ...SOURCE, employment: [] }).currentRole).toBeNull();
  });

  it('formats a year-only intake and a missing intake', () => {
    expect(buildFactualFrame({ ...SOURCE, target: { ...SOURCE.target, intakeMonth: null } }).target.intake).toBe('2027');
    expect(buildFactualFrame({ ...SOURCE, target: { ...SOURCE.target, intakeMonth: null, intakeYear: null } }).target.intake).toBeNull();
  });
});

describe('parseAiSopParts — tolerant narrative parse', () => {
  it('parses a well-formed reply', () => {
    expect(parseAiSopParts(JSON.stringify(AI_PARTS))).toEqual(AI_PARTS);
  });

  it('strips markdown fences', () => {
    const fenced = '```json\n' + JSON.stringify(AI_PARTS) + '\n```';
    expect(parseAiSopParts(fenced)).toEqual(AI_PARTS);
  });

  it('fills missing sections with empty strings (never throws)', () => {
    const partial = parseAiSopParts(JSON.stringify({ careerPlan: 'x' }));
    expect(partial.careerPlan).toBe('x');
    expect(partial.homeTies).toBe('');
    expect(partial.intro).toBe('');
  });

  it('returns all-empty on garbage input without throwing', () => {
    const out = parseAiSopParts('not json at all');
    expect(Object.values(out).every((v) => v === '')).toBe(true);
  });
});

describe('TRUTHFULNESS — the target institution shapes the narrative but can never alter a factual claim', () => {
  it('assembleSop builds the frame purely from source, independent of the AI narrative', () => {
    const content = assembleSop(SOURCE, AI_PARTS);
    // The institution SHAPES the narrative (the AI wrote it into whyThisInstitution)…
    expect(content.narrative.whyThisInstitution).toContain('University of Auckland');
    // …but the factual frame is byte-identical to the deterministic build from source.
    expect(content.frame).toEqual(buildFactualFrame(SOURCE));
  });

  it('even a malicious AI payload cannot inject or overwrite a factual claim in the frame', () => {
    // A hostile model reply that both fabricates a qualification in prose AND tries to smuggle
    // frame-shaped keys alongside the narrative.
    const malicious = {
      ...AI_PARTS,
      homeTies: 'I already hold a PhD from Stanford and a job offer in Auckland.', // fabricated prose
      // rogue frame-shaped keys that must be ignored by assembly:
      frame: { applicantName: 'Imposter', highestQualification: 'Doctorate' },
      applicantName: 'Imposter',
      target: { provider: 'Harvard' },
    } as unknown as AiSopParts;

    const content = assembleSop(SOURCE, malicious);
    // The frame is untouched by any of the injected keys…
    expect(content.frame.applicantName).toBe('Ava Sharma');
    expect(content.frame.highestQualification).toBe("Bachelor's degree");
    expect(content.frame.target.provider).toBe('University of Auckland');
    expect(content.frame).toEqual(buildFactualFrame(SOURCE));
    // …the fabricated prose lands only in the narrative body (visible to the reviewing specialist),
    // never promoted to a structured factual claim.
    expect(content.narrative.homeTies).toContain('Stanford');
  });
});

describe('parseGateVerdicts — fail-closed', () => {
  it('parses three passing verdicts', () => {
    const r = parseGateVerdicts(PASSING_VERDICTS);
    expect(SOP_GATE_KEYS.every((k) => r[k].pass)).toBe(true);
  });

  it('fails closed on a missing gate verdict', () => {
    const r = parseGateVerdicts(JSON.stringify({ careerPlan: { pass: true, reason: 'ok' }, nzReasoning: { pass: true, reason: 'ok' } }));
    expect(r.homeTies.pass).toBe(false);
  });

  it('fails closed on garbage input (no gate silently passes)', () => {
    const r = parseGateVerdicts('the model refused');
    expect(SOP_GATE_KEYS.some((k) => r[k].pass)).toBe(false);
  });

  it('treats a non-boolean pass as a failure (only explicit true passes)', () => {
    const r = parseGateVerdicts(JSON.stringify({
      careerPlan: { pass: 'true', reason: 'stringy' },
      nzReasoning: { pass: 1, reason: 'truthy' },
      homeTies: { pass: true, reason: 'real' },
    }));
    expect(r.careerPlan.pass).toBe(false);
    expect(r.nzReasoning.pass).toBe(false);
    expect(r.homeTies.pass).toBe(true);
  });
});

describe('evaluateGateEnforcement — hard-block only when enforced', () => {
  const allPass = parseGateVerdicts(PASSING_VERDICTS);
  const oneFail: SopGateResults = { ...allPass, homeTies: { pass: false, reason: 'Ties are generic.' } };

  it('all gates pass + enforced → does not block', () => {
    const e = evaluateGateEnforcement(allPass, true);
    expect(e.allPass).toBe(true);
    expect(e.blocksApproval).toBe(false);
    expect(e.failing).toEqual([]);
  });

  it('a failing gate + enforced → hard-blocks and names the failing gate', () => {
    const e = evaluateGateEnforcement(oneFail, true);
    expect(e.allPass).toBe(false);
    expect(e.failing).toEqual(['homeTies']);
    expect(e.blocksApproval).toBe(true);
  });

  it('a failing gate + NOT enforced → advisory only, never blocks', () => {
    const e = evaluateGateEnforcement(oneFail, false);
    expect(e.failing).toEqual(['homeTies']); // still surfaced
    expect(e.blocksApproval).toBe(false);
  });

  it('all gates pass + not enforced → does not block', () => {
    expect(evaluateGateEnforcement(allPass, false).blocksApproval).toBe(false);
  });
});
