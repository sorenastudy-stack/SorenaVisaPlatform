// PR-ADMISSION-CV (step 2b) — golden battery for CV assembly. Frozen before wiring.
// The load-bearing guarantee: factual sections come from the verified rows (never the AI), and
// the AI-parts parser is tolerant (never throws, always safe fallbacks).
import { buildFactualSections, parseAiCvParts, assembleCv, type CvSource } from './cv-content.logic';

const SOURCE: CvSource = {
  contact: { fullName: 'Ada Applicant', email: 'ada@x.test', phone: '+64 21 000', country: 'IR' },
  application: { dateOfBirth: '1998-05-02', citizenship: 'IR', countryOfBirth: 'IR', englishTestName: 'IELTS Academic', highestQualification: 'BACHELORS' },
  education: [
    { institutionName: 'Tehran University', qualificationLevel: 'BACHELORS', fieldOfStudy: 'Computer Science', country: 'IR', startYear: 2016, endYear: 2020, completed: true },
  ],
  employment: [
    { employerName: 'Acme Software', roleTitle: 'Software Engineer', organisationField: 'Software', countryOfWork: 'IR', startYear: 2020, endYear: null, isCurrent: true, dutiesText: 'Built web services.' },
  ],
  targetProgrammes: [
    { programmeName: 'Master of Information Technology', providerName: 'Aotearoa University', field: 'IT & Computer Science', level: 'MASTER' },
  ],
};

describe('buildFactualSections — deterministic, from verified rows only', () => {
  const f = buildFactualSections(SOURCE);
  it('header from contact + application', () => {
    expect(f.header).toEqual({ fullName: 'Ada Applicant', email: 'ada@x.test', phone: '+64 21 000', country: 'IR', dateOfBirth: '1998-05-02', nationality: 'IR' });
  });
  it('education maps rows with a humanised qualification label', () => {
    expect(f.education).toEqual([{ institution: 'Tehran University', qualification: "Bachelor's degree", field: 'Computer Science', country: 'IR', startYear: 2016, endYear: 2020, completed: true }]);
  });
  it('experience comes straight from the employment rows (real employer/role/dates)', () => {
    expect(f.experience).toEqual([{ employer: 'Acme Software', role: 'Software Engineer', field: 'Software', country: 'IR', startYear: 2020, endYear: null, isCurrent: true, duties: 'Built web services.' }]);
  });
  it('english from the admission test name; null when absent', () => {
    expect(f.english).toEqual({ test: 'IELTS Academic', note: null });
    expect(buildFactualSections({ ...SOURCE, application: { ...SOURCE.application, englishTestName: null } }).english).toBeNull();
  });
});

describe('parseAiCvParts — tolerant, never throws', () => {
  it('parses clean JSON', () => {
    expect(parseAiCvParts('{"summary":"Hi","skills":["a","b"]}')).toEqual({ summary: 'Hi', skills: ['a', 'b'] });
  });
  it('unwraps a ```json fence', () => {
    expect(parseAiCvParts('```json\n{"summary":"S","skills":["x"]}\n```')).toEqual({ summary: 'S', skills: ['x'] });
  });
  it('salvages JSON embedded in prose', () => {
    expect(parseAiCvParts('Here: {"summary":"S","skills":[]} thanks')).toEqual({ summary: 'S', skills: [] });
  });
  it('filters non-string / empty skills', () => {
    expect(parseAiCvParts('{"summary":"S","skills":["ok","",3,null,"  two "]}')).toEqual({ summary: 'S', skills: ['ok', 'two'] });
  });
  it('falls back safely on garbage / missing fields', () => {
    expect(parseAiCvParts('not json')).toEqual({ summary: '', skills: [] });
    expect(parseAiCvParts('{"skills":"nope"}')).toEqual({ summary: '', skills: [] });
    expect(parseAiCvParts('')).toEqual({ summary: '', skills: [] });
  });
});

describe('assembleCv — AI supplies ONLY summary + skills; facts unchanged', () => {
  it('grafts the AI narrative onto the deterministic factual sections', () => {
    const cv = assembleCv(SOURCE, { summary: 'AI summary', skills: ['TypeScript'] });
    expect(cv.summary).toBe('AI summary');
    expect(cv.skills).toEqual(['TypeScript']);
    // Facts are exactly the deterministic sections — not influenced by the AI parts.
    expect(cv.experience[0].employer).toBe('Acme Software');
    expect(cv.education[0].institution).toBe('Tehran University');
  });
  it('even a malicious AI-parts payload cannot alter the factual sections', () => {
    const cv = assembleCv(SOURCE, JSON.parse('{"summary":"x","skills":[],"experience":[{"employer":"FAKE"}]}'));
    expect(cv.experience[0].employer).toBe('Acme Software'); // FAKE never reaches the CV
  });
  it('the target programmes never leak into the factual sections (localization is narrative-only)', () => {
    const cv = assembleCv(SOURCE, { summary: 's', skills: [] });
    expect(JSON.stringify(cv.education)).not.toMatch(/Aotearoa University/);
    expect(cv.experience[0].employer).toBe('Acme Software');
  });
});
