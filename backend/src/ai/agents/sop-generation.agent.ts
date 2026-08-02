import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../claude.service';
import {
  parseAiSopParts,
  parseGateVerdicts,
  SOP_GATE_KEYS,
  type SopSource,
  type AiSopParts,
  type SopContent,
  type SopGateResults,
} from '../../students/admission/sop/sop-content.logic';

// PR-ADMISSION-SOP (step 3) — the SOP_GENERATION agent. A proper AI agent mirroring
// CvGenerationAgent/LeadQualificationAgent: it OWNS two dedicated prompts and both Claude calls,
// separate from the general ClaudeService usage and from the SopDocument lifecycle (SopService).
//
//  • generateNarrative — authors ONLY the labeled narrative sections; the factual frame is
//    assembled deterministically in sop-content.logic, so the agent can never fabricate a
//    credential/date. The prompt is LOCALIZED to the ONE target programme/institution/intake.
//  • evaluateGates — a SEPARATE, adversarial pass (skeptical INZ-officer rubric) that scores the
//    current narrative against the three genuine-temporary-entrant gates. Kept distinct from the
//    drafting call so the model doesn't grade its own work soft; re-runnable against hand-edited
//    content at approve time.
//
// Both never throw. On AI failure: generation returns empty sections (specialist writes them);
// gate evaluation FAILS CLOSED (all gates fail) so an outage can never wave an SOP through.
@Injectable()
export class SopGenerationAgent {
  private readonly logger = new Logger(SopGenerationAgent.name);
  constructor(private readonly claude: ClaudeService) {}

  private targetLine(source: SopSource): string {
    const t = source.target;
    return [t.programmeName, t.field, t.providerName].filter(Boolean).join(' — ');
  }

  private buildDraftPrompt(source: SopSource): { system: string; user: string } {
    const system = [
      'You write the narrative of a Statement of Purpose (SOP) for a New Zealand student-visa applicant.',
      'Return ONLY JSON with exactly these string keys:',
      '{"intro","careerPlan","whyNewZealand","whyThisInstitution","homeTies","conclusion"}.',
      'Ground every claim STRICTLY in the applicant data provided — NEVER invent qualifications, employers,',
      'dates, awards, or family circumstances. Do not restate contact details.',
      'The SOP is assessed against three genuine-temporary-entrant gates — write each relevant section to meet its bar:',
      '- careerPlan: a SPECIFIC, coherent post-study career plan (named role/sector and a rough timeline), not generic ambition.',
      '- whyNewZealand: reasons SPECIFIC to New Zealand (system, sector, setting) that would not equally apply to any country.',
      '- whyThisInstitution: reasons SPECIFIC to the chosen provider/programme (what it offers that fits the plan).',
      '- homeTies: CONCRETE ties to the home country showing genuine intent to return (family, assets, employment, obligations).',
      'No prose outside the JSON.',
    ].join('\n');
    const user = [
      `Target programme (localise the whole SOP to this): ${this.targetLine(source)}`,
      source.target.intakeYear ? `Intended intake: ${source.target.intakeMonth ?? ''}/${source.target.intakeYear}` : '',
      '',
      'Applicant data (authoritative — write only the narrative sections):',
      JSON.stringify({
        homeCountry: source.application.citizenship ?? source.contact.country ?? null,
        highestQualification: source.application.highestQualification,
        englishTest: source.application.englishTestName,
        education: source.education,
        employment: source.employment,
      }, null, 2),
    ].filter(Boolean).join('\n');
    return { system, user };
  }

  private buildGatePrompt(content: SopContent): { system: string; user: string } {
    const system = [
      'You are a skeptical Immigration New Zealand officer assessing a Statement of Purpose against three',
      'genuine-temporary-entrant criteria. For EACH gate, set pass:true ONLY if the SOP CLEARLY and SPECIFICALLY',
      'meets the bar. Default to pass:false whenever the text is generic, vague, could apply to any applicant/country,',
      'or is empty. Be strict — a plausible-sounding but non-specific statement FAILS.',
      'Gates:',
      '- careerPlan: names a specific post-study career (role/sector) with a coherent, realistic timeline.',
      '- nzReasoning: gives reasons specific to New Zealand AND to the chosen institution/programme (not generic study-abroad reasons).',
      '- homeTies: shows concrete, verifiable-sounding ties to the home country establishing intent to return.',
      'Return ONLY JSON: {"careerPlan":{"pass":boolean,"reason":string},"nzReasoning":{"pass":boolean,"reason":string},"homeTies":{"pass":boolean,"reason":string}}.',
      'Each reason: one short sentence the Admission Specialist can act on. No prose outside the JSON.',
    ].join('\n');
    const user = [
      `Target: ${content.frame.target.programme}${content.frame.target.provider ? ' at ' + content.frame.target.provider : ''}`,
      `Applicant home country: ${content.frame.homeCountry ?? 'unknown'}`,
      '',
      'SOP narrative sections to assess:',
      JSON.stringify({
        careerPlan: content.narrative.careerPlan,
        whyNewZealand: content.narrative.whyNewZealand,
        whyThisInstitution: content.narrative.whyThisInstitution,
        homeTies: content.narrative.homeTies,
      }, null, 2),
    ].join('\n');
    return { system, user };
  }

  // Draft the narrative. Never throws — on any AI failure returns empty sections + available:false
  // so the SOP still assembles from the factual frame (the specialist writes the prose).
  async generateNarrative(source: SopSource): Promise<{ parts: AiSopParts; available: boolean }> {
    const { system, user } = this.buildDraftPrompt(source);
    try {
      const raw = await this.claude.extractJson(system, user, { maxTokens: 2000 });
      return { parts: parseAiSopParts(raw), available: true };
    } catch (e: any) {
      this.logger.warn(`SOP narrative unavailable: ${e?.message ?? e}`);
      return { parts: parseAiSopParts(''), available: false };
    }
  }

  // Adversarially score the three gates against the CURRENT content. Never throws — on any AI
  // failure returns FAIL-CLOSED verdicts (every gate fails) + available:false, so an outage can
  // never let an SOP through an enforced gate.
  async evaluateGates(content: SopContent): Promise<{ results: SopGateResults; available: boolean }> {
    const { system, user } = this.buildGatePrompt(content);
    try {
      const raw = await this.claude.extractJson(system, user, { maxTokens: 800 });
      return { results: parseGateVerdicts(raw), available: true };
    } catch (e: any) {
      this.logger.warn(`SOP gate evaluation unavailable: ${e?.message ?? e}`);
      const failClosed = {} as SopGateResults;
      for (const k of SOP_GATE_KEYS) failClosed[k] = { pass: false, reason: 'Gate evaluation unavailable — try again.' };
      return { results: failClosed, available: false };
    }
  }
}
