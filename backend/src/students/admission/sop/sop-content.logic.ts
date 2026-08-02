// PR-ADMISSION-SOP (step 3) — pure SOP assembly + gate logic. NO I/O: the DB rows come in, the
// Claude calls (drafting + gate evaluation) happen in the SopGenerationAgent. Two guarantees live
// here, both AI-free and golden-frozen before any wiring:
//
//  1. TRUTHFULNESS. An SOP is prose, so unlike the CV it can't be assembled entirely from rows —
//     but the FACTUAL FRAME (applicant name + the target institution/programme/intake + a verified
//     profile line) IS deterministic. assembleSop takes the AI narrative and drops it onto a frame
//     built purely from source rows, so the target institution can SHAPE the narrative body while
//     being structurally unable to alter/fabricate a factual claim in the frame.
//  2. GATE ENFORCEMENT. The three quality gates are AI-SCORED (the rubric + call live in the
//     agent), but PARSING the verdicts and DECIDING whether a failure blocks approval are pure and
//     testable here. Fail-closed: an unparseable/missing gate verdict never counts as a pass.

import { qualificationLabel } from '../cv/cv-content.logic';

// ─── Source (verified rows) ──────────────────────────────────────────────────

export interface SopSource {
  contact: { fullName: string; country?: string | null };
  application: {
    highestQualification?: string | null;
    citizenship?: string | null;
    countryOfBirth?: string | null;
    englishTestName?: string | null;
  };
  education: Array<{
    institutionName: string; qualificationLevel: string; fieldOfStudy?: string | null;
    country?: string | null; startYear?: number | null; endYear?: number | null; completed: boolean;
  }>;
  employment: Array<{
    employerName: string; roleTitle: string; organisationField?: string | null; countryOfWork?: string | null;
    startYear?: number | null; endYear?: number | null; isCurrent: boolean; dutiesText?: string | null;
  }>;
  // The ONE programme this SOP targets (one SOP per submitted programme choice). Drives the whole
  // localization: the institution/programme/intake the argument must be specific to.
  target: {
    programmeName: string; providerName: string | null; field: string | null; level: string | null;
    intakeMonth: number | null; intakeYear: number | null;
  };
}

// ─── Content (frame = deterministic, narrative = AI) ─────────────────────────

export interface SopFactualFrame {
  applicantName: string;
  homeCountry: string | null;
  highestQualification: string | null; // display-labeled
  currentRole: string | null; // "Role at Employer" from the verified current-employment row
  englishTest: string | null;
  target: { programme: string; provider: string | null; field: string | null; level: string | null; intake: string | null };
}

// The AI authors ONLY these labeled sections. They map 1:1 onto the three gates plus framing prose.
export interface SopNarrative {
  intro: string;
  careerPlan: string; // gate 1: career-plan specificity
  whyNewZealand: string; // gate 2 (part a): NZ-specific reasoning
  whyThisInstitution: string; // gate 2 (part b): institution-specific reasoning
  homeTies: string; // gate 3: home-country ties
  conclusion: string;
}

export interface SopContent {
  frame: SopFactualFrame; // deterministic — the AI can never touch this
  narrative: SopNarrative; // AI-authored
}

export type AiSopParts = SopNarrative;

const NARRATIVE_KEYS: Array<keyof SopNarrative> = [
  'intro', 'careerPlan', 'whyNewZealand', 'whyThisInstitution', 'homeTies', 'conclusion',
];

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatIntake(month: number | null, year: number | null): string | null {
  const m = month && month >= 1 && month <= 12 ? MONTHS[month] : null;
  if (m && year) return `${m} ${year}`;
  if (year) return String(year);
  return null;
}

// The verified current role, if any: prefer the isCurrent row, else the latest by startYear.
function deriveCurrentRole(employment: SopSource['employment']): string | null {
  if (employment.length === 0) return null;
  const current = employment.find((e) => e.isCurrent);
  const pick = current
    ?? [...employment].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))[0];
  if (!pick) return null;
  return `${pick.roleTitle} at ${pick.employerName}`;
}

// Deterministic factual frame straight from verified rows. No AI involvement — the AI narrative is
// dropped onto this, never the other way around.
export function buildFactualFrame(source: SopSource): SopFactualFrame {
  return {
    applicantName: source.contact.fullName,
    homeCountry: source.application.citizenship ?? source.contact.country ?? null,
    highestQualification: source.application.highestQualification
      ? qualificationLabel(source.application.highestQualification)
      : null,
    currentRole: deriveCurrentRole(source.employment),
    englishTest: source.application.englishTestName ?? null,
    target: {
      programme: source.target.programmeName,
      provider: source.target.providerName ?? null,
      field: source.target.field ?? null,
      level: source.target.level ?? null,
      intake: formatIntake(source.target.intakeMonth, source.target.intakeYear),
    },
  };
}

const stripFences = (raw: string): string =>
  raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

function coerceJson(raw: string): Record<string, unknown> {
  const text = stripFences((raw ?? '').trim()).trim();
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { const j = JSON.parse(m[0]); return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}; } catch { return {}; } }
    return {};
  }
}

// Tolerant parse of the model's narrative reply. Never throws — a bad AI reply must not break
// generation; missing sections fall back to '' (an empty section the specialist fills in).
export function parseAiSopParts(raw: string): AiSopParts {
  const o = coerceJson(raw);
  const out = {} as AiSopParts;
  for (const k of NARRATIVE_KEYS) {
    out[k] = typeof o[k] === 'string' ? (o[k] as string).trim() : '';
  }
  return out;
}

// assembleSop drops the AI narrative onto a frame built PURELY from source. The frame is recomputed
// from source here (never taken from aiParts), so no AI payload — however malicious — can alter a
// factual claim. This is the SOP analogue of the CV's deterministic factual sections.
export function assembleSop(source: SopSource, aiParts: AiSopParts): SopContent {
  return { frame: buildFactualFrame(source), narrative: { ...aiParts } };
}

// ─── Quality gates ───────────────────────────────────────────────────────────

export type SopGateKey = 'careerPlan' | 'nzReasoning' | 'homeTies';
export const SOP_GATE_KEYS: SopGateKey[] = ['careerPlan', 'nzReasoning', 'homeTies'];
export const SOP_GATE_LABEL: Record<SopGateKey, string> = {
  careerPlan: 'Career-plan specificity',
  nzReasoning: 'New Zealand–specific reasoning',
  homeTies: 'Home-country ties',
};

export interface SopGateVerdict { pass: boolean; reason: string }
export type SopGateResults = Record<SopGateKey, SopGateVerdict>;

export interface SopGateEvaluation {
  results: SopGateResults;
  enforced: boolean; // was the country's sopGateEnforcement flag on at evaluation time
  allPass: boolean;
  failing: SopGateKey[];
  blocksApproval: boolean; // enforced && !allPass — the hard-block decision
}

const FAIL_CLOSED = (reason: string): SopGateVerdict => ({ pass: false, reason });

// Tolerant parse of the AI gate-evaluation reply: { careerPlan: {pass, reason}, nzReasoning: {...},
// homeTies: {...} }. FAIL-CLOSED — a missing/garbled verdict is a FAILURE, never a silent pass, so
// an unparseable evaluation can never wave an SOP through an enforced gate. Never throws.
export function parseGateVerdicts(raw: string): SopGateResults {
  const o = coerceJson(raw);
  const results = {} as SopGateResults;
  for (const key of SOP_GATE_KEYS) {
    const v = o[key];
    if (!v || typeof v !== 'object') {
      results[key] = FAIL_CLOSED('No verdict returned for this gate.');
      continue;
    }
    const rec = v as Record<string, unknown>;
    // pass must be an explicit boolean true; anything else fails closed.
    const pass = rec.pass === true;
    const reason = typeof rec.reason === 'string' && rec.reason.trim() ? rec.reason.trim() : (pass ? 'Meets the standard.' : 'Does not meet the standard.');
    results[key] = { pass, reason };
  }
  return results;
}

// Pure enforcement decision. `enforced` = the case's country CountryAIConfig.sopGateEnforcement.
// When enforced and any gate fails → blocksApproval. When not enforced → advisory (never blocks),
// but the verdicts are still surfaced. Deterministic; the golden battery pins every quadrant.
export function evaluateGateEnforcement(results: SopGateResults, enforced: boolean): SopGateEvaluation {
  const failing = SOP_GATE_KEYS.filter((k) => !results[k]?.pass);
  const allPass = failing.length === 0;
  return { results, enforced, allPass, failing, blocksApproval: enforced && !allPass };
}
