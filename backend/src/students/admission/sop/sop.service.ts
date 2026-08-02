import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SopGenerationAgent } from '../../../ai/agents/sop-generation.agent';
import {
  assembleSop,
  evaluateGateEnforcement,
  SOP_GATE_LABEL,
  type SopSource,
  type SopGateResults,
  type SopGateEvaluation,
} from './sop-content.logic';

// PR-ADMISSION-SOP (step 3) — the SOP-document LIFECYCLE orchestrator (generate/review/edit/
// evaluate/approve/version/lock), ONE SOP per submitted programme choice. Generation + gate
// scoring live in the SopGenerationAgent (ai/agents); this service gathers verified data per
// choice, delegates, assembles onto the deterministic factual frame, resolves the per-country
// enforcement flag, and persists a versioned SopDocument. Generation is GATED to submitted
// applications (shared finality point with Step 4), like the CV. The three quality gates are
// RE-EVALUATED against the current (possibly hand-edited) content at approve time and HARD-BLOCK
// approval when the case's country sopGateEnforcement is on.
@Injectable()
export class SopService {
  private readonly logger = new Logger(SopService.name);
  constructor(private readonly prisma: PrismaService, private readonly sopAgent: SopGenerationAgent) {}

  // ─── gather ─────────────────────────────────────────────────────────────

  private async loadApp(caseId: string) {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { lead: { include: { contact: { select: { fullName: true, countryOfResidence: true, nationality: true } } } } },
    });
    if (!kase) throw new NotFoundException('Case not found');
    const app = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      include: {
        educationEntries: { orderBy: { sortOrder: 'asc' } },
        employmentEntries: { orderBy: { sortOrder: 'asc' } },
        programmeChoices: {
          orderBy: { priority: 'asc' },
          include: {
            programme: {
              select: {
                name: true, level: true,
                provider: { select: { name: true } },
                studyFields: { take: 1, include: { studyField: { select: { nameEn: true } } } },
              },
            },
          },
        },
      },
    });
    return { kase, app };
  }

  // Build the SOP source for ONE programme choice (localised to that institution/programme/intake).
  private buildSource(
    kase: { lead: { contact: { fullName: string | null; countryOfResidence: string | null; nationality: string | null } | null } | null },
    app: any,
    choice: any,
  ): SopSource {
    const c = kase.lead?.contact;
    return {
      contact: { fullName: c?.fullName ?? 'Applicant', country: c?.countryOfResidence ?? c?.nationality ?? null },
      application: {
        highestQualification: app?.highestQualification ?? null,
        citizenship: app?.citizenship ?? null,
        countryOfBirth: app?.countryOfBirth ?? null,
        englishTestName: app?.englishTestName ?? null,
      },
      education: (app?.educationEntries ?? []).map((e: any) => ({
        institutionName: e.institutionName, qualificationLevel: e.qualificationLevel, fieldOfStudy: e.fieldOfStudy,
        country: e.country, startYear: e.startYear, endYear: e.endYear, completed: e.completed,
      })),
      employment: (app?.employmentEntries ?? []).map((e: any) => ({
        employerName: e.employerName, roleTitle: e.roleTitle, organisationField: e.organisationField,
        countryOfWork: e.countryOfWork, startYear: e.startYear, endYear: e.endYear, isCurrent: e.isCurrent, dutiesText: e.dutiesText,
      })),
      target: {
        programmeName: choice.programme.name,
        providerName: choice.programme.provider?.name ?? null,
        field: choice.programme.studyFields[0]?.studyField?.nameEn ?? null,
        level: choice.programme.level ?? null,
        intakeMonth: choice.intakeMonth ?? null,
        intakeYear: choice.intakeYear ?? null,
      },
    };
  }

  // Resolve the case's country sopGateEnforcement. Keyed by the applicant's country of residence
  // (falling back to nationality). Defaults to ENFORCED (true) — matching the schema default — so a
  // missing country config never silently disables the gates.
  private async resolveEnforced(countryRaw: string | null): Promise<boolean> {
    const code = (countryRaw ?? '').trim().toUpperCase();
    if (!code) return true;
    const cfg = await this.prisma.countryAIConfig.findUnique({
      where: { countryCode: code }, select: { sopGateEnforcement: true },
    });
    return cfg?.sopGateEnforcement ?? true;
  }

  private shape(sop: {
    id: string; admissionProgrammeChoiceId: string; version: number; status: string; contentJson: unknown;
    gateResultsJson: unknown; generatedAt: Date; editedAt: Date | null; approvedAt: Date | null; approvedById: string | null;
  }) {
    return {
      id: sop.id, choiceId: sop.admissionProgrammeChoiceId, version: sop.version, status: sop.status,
      content: sop.contentJson, gates: sop.gateResultsJson ?? null,
      generatedAt: sop.generatedAt, editedAt: sop.editedAt, approvedAt: sop.approvedAt, approvedById: sop.approvedById,
    };
  }

  // ─── read ───────────────────────────────────────────────────────────────

  // The Case File SOP surface: every submitted programme choice with its current SOP (if any).
  async list(caseId: string) {
    const { app } = await this.loadApp(caseId);
    const choices = app?.programmeChoices ?? [];
    const out = [];
    for (const ch of choices) {
      const current = await this.prisma.sopDocument.findFirst({
        where: { admissionProgrammeChoiceId: ch.id }, orderBy: { version: 'desc' },
      });
      out.push({
        choiceId: ch.id,
        priority: ch.priority,
        programme: ch.programme.name,
        provider: ch.programme.provider?.name ?? null,
        intake: { month: ch.intakeMonth ?? null, year: ch.intakeYear ?? null },
        sop: current ? this.shape(current) : null,
      });
    }
    return { applicationStatus: app?.status ?? null, choices: out };
  }

  // ─── generate ─────────────────────────────────────────────────────────────

  private assertSubmitted(status: string | null) {
    if (status !== 'SUBMITTED' && status !== 'LOCKED') {
      throw new BadRequestException('Generate SOPs after the client submits their programme choices — each SOP is tailored to the chosen institution.');
    }
  }

  async generate(caseId: string, choiceId: string, actorId: string | null) {
    const { kase, app } = await this.loadApp(caseId);
    this.assertSubmitted(app?.status ?? null);
    const choice = (app?.programmeChoices ?? []).find((c: any) => c.id === choiceId);
    if (!choice) throw new NotFoundException('Programme choice not found on this case.');

    const source = this.buildSource(kase!, app, choice);
    const { parts, available } = await this.sopAgent.generateNarrative(source);
    const content = assembleSop(source, parts);
    // Score the fresh draft immediately so the specialist sees gate status on first render.
    const { results } = await this.sopAgent.evaluateGates(content);
    const enforced = await this.resolveEnforced(kase!.lead?.contact?.countryOfResidence ?? kase!.lead?.contact?.nationality ?? null);
    const evaluation = evaluateGateEnforcement(results, enforced);

    const sop = await this.prisma.$transaction(async (tx) => {
      await tx.sopDocument.updateMany({ where: { admissionProgrammeChoiceId: choiceId, status: 'DRAFT' }, data: { status: 'SUPERSEDED' } });
      const last = await tx.sopDocument.findFirst({ where: { admissionProgrammeChoiceId: choiceId }, orderBy: { version: 'desc' } });
      return tx.sopDocument.create({
        data: {
          caseId, admissionProgrammeChoiceId: choiceId, version: (last?.version ?? 0) + 1, status: 'DRAFT',
          contentJson: content as never, sourceSnapshotJson: source as never, gateResultsJson: evaluation as never,
          model: available ? (process.env.CLAUDE_MODEL || 'claude-opus-4-5') : null,
          generatedById: actorId,
        },
      });
    });
    return { ...this.shape(sop), aiUnavailable: !available };
  }

  // Convenience: generate an SOP for every submitted choice that doesn't yet have a current draft.
  async generateAll(caseId: string, actorId: string | null) {
    const { app } = await this.loadApp(caseId);
    this.assertSubmitted(app?.status ?? null);
    const results = [];
    for (const ch of app?.programmeChoices ?? []) {
      results.push(await this.generate(caseId, ch.id, actorId));
    }
    return { generated: results.length, items: results };
  }

  // ─── edit / evaluate / approve ────────────────────────────────────────────

  private async loadSop(caseId: string, sopId: string) {
    const sop = await this.prisma.sopDocument.findUnique({ where: { id: sopId } });
    if (!sop || sop.caseId !== caseId) throw new NotFoundException('SOP not found on this case.');
    return sop;
  }

  // Re-score the gates against the CURRENT stored content (no lifecycle change). Used by the UI to
  // preview whether an SOP would pass before approving, and shared by approve().
  async evaluate(caseId: string, sopId: string): Promise<SopGateEvaluation> {
    const sop = await this.loadSop(caseId, sopId);
    const enforced = await this.enforcedForCase(caseId);
    const { results } = await this.sopAgent.evaluateGates(sop.contentJson as never);
    const evaluation = evaluateGateEnforcement(results, enforced);
    await this.prisma.sopDocument.update({ where: { id: sopId }, data: { gateResultsJson: evaluation as never } });
    return evaluation;
  }

  private async enforcedForCase(caseId: string): Promise<boolean> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { lead: { include: { contact: { select: { countryOfResidence: true, nationality: true } } } } },
    });
    return this.resolveEnforced(kase?.lead?.contact?.countryOfResidence ?? kase?.lead?.contact?.nationality ?? null);
  }

  async update(caseId: string, sopId: string, content: unknown) {
    const sop = await this.loadSop(caseId, sopId);
    if (sop.status !== 'DRAFT') throw new ConflictException('This SOP version is approved (locked). Regenerate to make a new editable version.');
    if (typeof content !== 'object' || content === null) throw new BadRequestException('content must be an object.');
    // Re-score gates against the edited content so the stored verdicts never go stale vs. the text.
    const enforced = await this.enforcedForCase(caseId);
    const { results } = await this.sopAgent.evaluateGates(content as never);
    const evaluation = evaluateGateEnforcement(results, enforced);
    const updated = await this.prisma.sopDocument.update({
      where: { id: sopId }, data: { contentJson: content as never, gateResultsJson: evaluation as never, editedAt: new Date() },
    });
    return { ...this.shape(updated), gateEvaluation: evaluation };
  }

  private gateFailureMessage(results: SopGateResults, failing: string[]): string {
    const lines = failing.map((k) => `${SOP_GATE_LABEL[k as keyof typeof SOP_GATE_LABEL]}: ${results[k as keyof SopGateResults].reason}`);
    return `This SOP does not yet pass the required quality gates:\n- ${lines.join('\n- ')}\nEdit the statement and try again.`;
  }

  async approve(caseId: string, sopId: string, actorId: string | null) {
    const sop = await this.loadSop(caseId, sopId);
    if (sop.status !== 'DRAFT') throw new ConflictException('Only a draft SOP can be approved.');

    // Authoritative gate re-evaluation against CURRENT content — never trust a stored verdict.
    const enforced = await this.enforcedForCase(caseId);
    const { results } = await this.sopAgent.evaluateGates(sop.contentJson as never);
    const evaluation = evaluateGateEnforcement(results, enforced);
    // Persist the fresh verdict so the UI reflects it whether or not approval proceeds.
    await this.prisma.sopDocument.update({ where: { id: sopId }, data: { gateResultsJson: evaluation as never } });

    if (evaluation.blocksApproval) {
      throw new BadRequestException(this.gateFailureMessage(results, evaluation.failing));
    }

    const updated = await this.prisma.sopDocument.update({
      where: { id: sopId }, data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
    });
    return { ...this.shape(updated), gateEvaluation: evaluation };
  }
}
