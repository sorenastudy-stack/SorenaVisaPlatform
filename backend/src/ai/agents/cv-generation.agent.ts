import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../claude.service';
import { parseAiCvParts, type CvSource, type AiCvParts } from '../../students/admission/cv/cv-content.logic';

// PR-ADMISSION-CV (restructure) — the CV_GENERATION agent. A proper AI agent (mirrors
// LeadQualificationAgent): it OWNS the dedicated CV prompt and the Claude call, separate from
// the general ClaudeService usage and from the CvDocument lifecycle (CvService). It authors
// ONLY the narrative { summary, skills } — the factual sections are assembled deterministically
// elsewhere (cv-content.logic), so the agent can never fabricate an employer/date. The prompt is
// LOCALIZED to the applicant's chosen programmes (target field/university), which is why this
// runs only after the client submits their choices.
@Injectable()
export class CvGenerationAgent {
  private readonly logger = new Logger(CvGenerationAgent.name);
  constructor(private readonly claude: ClaudeService) {}

  private buildPrompt(source: CvSource): { system: string; user: string } {
    const targets = source.targetProgrammes.map((t) =>
      [t.programmeName, t.field, t.providerName].filter(Boolean).join(' — '),
    );
    const system = [
      'You write the narrative parts of a CV for a New Zealand student-visa applicant.',
      'Return ONLY JSON: {"summary": string, "skills": string[]}.',
      '- summary: a concise, professional 2–4 sentence profile grounded in the applicant\'s REAL education and work history below,',
      '  and TAILORED toward the programme(s) they have chosen to study (target field / university). Make the fit to that field evident.',
      '- skills: 4–10 short skill phrases inferred from their field of study, roles, and the target programme field.',
      'NEVER invent employers, job titles, qualifications, institutions, dates, or certifications — the factual sections are supplied',
      'and you must not add facts not present. Do not include contact details. No prose outside the JSON.',
    ].join('\n');
    const user = [
      targets.length
        ? `Target programme(s) the applicant chose (tailor the profile toward these):\n${targets.map((t) => `- ${t}`).join('\n')}`
        : 'Target programme(s): (none specified)',
      '',
      'Applicant data (facts are authoritative — write only the summary + skills):',
      JSON.stringify({ education: source.education, employment: source.employment, application: source.application }, null, 2),
    ].join('\n');
    return { system, user };
  }

  // Generate the narrative. Never throws — on any AI failure returns empty parts + available:false
  // so the CV still assembles from verified facts (the specialist writes the narrative manually).
  async generateNarrative(source: CvSource): Promise<{ parts: AiCvParts; available: boolean }> {
    const { system, user } = this.buildPrompt(source);
    try {
      const raw = await this.claude.extractJson(system, user, { maxTokens: 1500 });
      return { parts: parseAiCvParts(raw), available: true };
    } catch (e: any) {
      this.logger.warn(`CV narrative unavailable: ${e?.message ?? e}`);
      return { parts: { summary: '', skills: [] }, available: false };
    }
  }
}
