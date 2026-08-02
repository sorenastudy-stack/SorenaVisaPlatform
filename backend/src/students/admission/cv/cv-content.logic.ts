// PR-ADMISSION-CV (step 2b) — pure CV assembly. NO I/O: the DB rows come in, the Claude call
// happens in the service. The TRUTHFULNESS GUARANTEE lives here: the factual sections
// (header / education / experience / english) are assembled DETERMINISTICALLY from verified
// rows; the AI only supplies the narrative { summary, skills }. So a CV sent to a university can
// never contain a fabricated employer, qualification, or date — the AI never authors those.
// Golden-frozen before wiring.

export interface CvSource {
  contact: { fullName: string; email?: string | null; phone?: string | null; country?: string | null };
  application: {
    dateOfBirth?: string | null; citizenship?: string | null; countryOfBirth?: string | null;
    englishTestName?: string | null; highestQualification?: string | null;
  };
  education: Array<{
    institutionName: string; qualificationLevel: string; fieldOfStudy?: string | null;
    country?: string | null; startYear?: number | null; endYear?: number | null; completed: boolean;
  }>;
  employment: Array<{
    employerName: string; roleTitle: string; organisationField?: string | null; countryOfWork?: string | null;
    startYear?: number | null; endYear?: number | null; isCurrent: boolean; dutiesText?: string | null;
  }>;
  // PR-ADMISSION-CV (localization) — the programmes the client actually CHOSE and submitted.
  // Drives a CV tailored to the target field/university (not a generic document). Present only
  // after the application is submitted (the generation gate).
  targetProgrammes: Array<{ programmeName: string; providerName: string | null; field: string | null; level: string | null }>;
}

export interface CvContent {
  header: { fullName: string; email: string | null; phone: string | null; country: string | null; dateOfBirth: string | null; nationality: string | null };
  summary: string; // AI-authored
  education: Array<{ institution: string; qualification: string; field: string | null; country: string | null; startYear: number | null; endYear: number | null; completed: boolean }>;
  experience: Array<{ employer: string; role: string; field: string | null; country: string | null; startYear: number | null; endYear: number | null; isCurrent: boolean; duties: string | null }>;
  english: { test: string; note: string | null } | null;
  skills: string[]; // AI-authored
}

export interface AiCvParts {
  summary: string;
  skills: string[];
}

const QUALIFICATION_LABEL: Record<string, string> = {
  INTERMEDIATE: 'Intermediate',
  HIGH_SCHOOL: 'High school',
  CERTIFICATE: 'Certificate',
  DIPLOMA: 'Diploma',
  ASSOCIATE_DEGREE: 'Associate degree',
  BACHELORS: "Bachelor's degree",
  MASTERS: "Master's degree",
  DOCTORATE: 'Doctorate',
  OTHER: 'Other qualification',
};
export const qualificationLabel = (level: string) => QUALIFICATION_LABEL[level] ?? level;

// Deterministic factual sections straight from verified rows. Order preserved (rows arrive
// sortOrder-ascending). No AI involvement.
export function buildFactualSections(source: CvSource): Omit<CvContent, 'summary' | 'skills'> {
  return {
    header: {
      fullName: source.contact.fullName,
      email: source.contact.email ?? null,
      phone: source.contact.phone ?? null,
      country: source.contact.country ?? null,
      dateOfBirth: source.application.dateOfBirth ?? null,
      nationality: source.application.citizenship ?? null,
    },
    education: source.education.map((e) => ({
      institution: e.institutionName,
      qualification: qualificationLabel(e.qualificationLevel),
      field: e.fieldOfStudy ?? null,
      country: e.country ?? null,
      startYear: e.startYear ?? null,
      endYear: e.endYear ?? null,
      completed: e.completed,
    })),
    experience: source.employment.map((e) => ({
      employer: e.employerName,
      role: e.roleTitle,
      field: e.organisationField ?? null,
      country: e.countryOfWork ?? null,
      startYear: e.startYear ?? null,
      endYear: e.endYear ?? null,
      isCurrent: e.isCurrent,
      duties: e.dutiesText ?? null,
    })),
    english: source.application.englishTestName
      ? { test: source.application.englishTestName, note: null }
      : null,
  };
}

const stripFences = (raw: string): string =>
  raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

// Tolerant parse of the model's { summary, skills } reply. Returns safe fallbacks (never
// throws) — a bad AI reply must not break generation; the specialist can still edit.
export function parseAiCvParts(raw: string): AiCvParts {
  const text = stripFences((raw ?? '').trim()).trim();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { json = JSON.parse(m[0]); } catch { json = null; } }
    }
  }
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  const skills = Array.isArray(o.skills)
    ? o.skills.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
    : [];
  return { summary, skills };
}

export function assembleCv(source: CvSource, aiParts: AiCvParts): CvContent {
  return { ...buildFactualSections(source), summary: aiParts.summary, skills: aiParts.skills };
}

// NOTE: the CV prompt lives in the CvGenerationAgent (ai/agents/cv-generation.agent.ts) — the
// agent owns its dedicated prompt + Claude call. This file stays pure: factual assembly + parsing.
