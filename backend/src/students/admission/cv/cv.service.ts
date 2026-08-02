import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClaudeService } from '../../../ai/claude.service';
import {
  buildCvPrompt, parseAiCvParts, assembleCv, type CvSource, type AiCvParts,
} from './cv-content.logic';

// PR-ADMISSION-CV (step 2b) — AI CV generation + Admission Specialist review/edit/approve.
// Versioned per case: regenerate supersedes the prior DRAFT and mints v+1; approve LOCKS a
// version. The factual sections are assembled deterministically (cv-content.logic) — the AI
// only writes summary/skills — so nothing factual can be fabricated. If the AI is unavailable
// (no key / error), the CV STILL generates with real facts + an empty narrative the specialist
// writes themselves (never blocks on the AI).
@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  constructor(private readonly prisma: PrismaService, private readonly claude: ClaudeService) {}

  private async gather(caseId: string): Promise<CvSource> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { lead: { include: { contact: { select: { fullName: true, email: true, phone: true, countryOfResidence: true } } } } },
    });
    if (!kase) throw new NotFoundException('Case not found');
    const app = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      include: {
        educationEntries: { orderBy: { sortOrder: 'asc' } },
        employmentEntries: { orderBy: { sortOrder: 'asc' } },
      },
    });
    const c = kase.lead?.contact;
    return {
      contact: { fullName: c?.fullName ?? 'Applicant', email: c?.email ?? null, phone: c?.phone ?? null, country: c?.countryOfResidence ?? null },
      application: {
        dateOfBirth: app?.dateOfBirth ? app.dateOfBirth.toISOString().slice(0, 10) : null,
        citizenship: app?.citizenship ?? null,
        countryOfBirth: app?.countryOfBirth ?? null,
        englishTestName: app?.englishTestName ?? null,
        highestQualification: app?.highestQualification ?? null,
      },
      education: (app?.educationEntries ?? []).map((e) => ({
        institutionName: e.institutionName, qualificationLevel: e.qualificationLevel, fieldOfStudy: e.fieldOfStudy,
        country: e.country, startYear: e.startYear, endYear: e.endYear, completed: e.completed,
      })),
      employment: (app?.employmentEntries ?? []).map((e) => ({
        employerName: e.employerName, roleTitle: e.roleTitle, organisationField: e.organisationField,
        countryOfWork: e.countryOfWork, startYear: e.startYear, endYear: e.endYear, isCurrent: e.isCurrent, dutiesText: e.dutiesText,
      })),
    };
  }

  private shape(cv: {
    id: string; version: number; status: string; contentJson: unknown; generatedAt: Date;
    editedAt: Date | null; approvedAt: Date | null; approvedById: string | null;
  }) {
    return {
      id: cv.id, version: cv.version, status: cv.status, content: cv.contentJson,
      generatedAt: cv.generatedAt, editedAt: cv.editedAt, approvedAt: cv.approvedAt, approvedById: cv.approvedById,
    };
  }

  async generate(caseId: string, actorId: string | null) {
    const source = await this.gather(caseId);
    const { system, user } = buildCvPrompt(source);

    let aiParts: AiCvParts = { summary: '', skills: [] };
    let aiUnavailable = false;
    try {
      const raw = await this.claude.extractJson(system, user, { maxTokens: 1500 });
      aiParts = parseAiCvParts(raw);
    } catch (e: any) {
      aiUnavailable = true; // factual CV still generates; specialist writes the narrative
      this.logger.warn(`CV narrative unavailable for case ${caseId}: ${e?.message ?? e}`);
    }
    const content = assembleCv(source, aiParts);

    const cv = await this.prisma.$transaction(async (tx) => {
      await tx.cvDocument.updateMany({ where: { caseId, status: 'DRAFT' }, data: { status: 'SUPERSEDED' } });
      const last = await tx.cvDocument.findFirst({ where: { caseId }, orderBy: { version: 'desc' } });
      return tx.cvDocument.create({
        data: {
          caseId, version: (last?.version ?? 0) + 1, status: 'DRAFT',
          contentJson: content as never, sourceSnapshotJson: source as never,
          model: aiUnavailable ? null : (process.env.CLAUDE_MODEL || 'claude-opus-4-5'),
          generatedById: actorId,
        },
      });
    });
    return { ...this.shape(cv), aiUnavailable };
  }

  async getCurrent(caseId: string) {
    const versions = await this.prisma.cvDocument.findMany({
      where: { caseId }, orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, generatedAt: true, approvedAt: true },
    });
    if (versions.length === 0) return { current: null, versions: [] };
    const current = await this.prisma.cvDocument.findFirst({ where: { caseId }, orderBy: { version: 'desc' } });
    return { current: current ? this.shape(current) : null, versions };
  }

  async update(caseId: string, cvId: string, content: unknown) {
    const cv = await this.prisma.cvDocument.findUnique({ where: { id: cvId } });
    if (!cv || cv.caseId !== caseId) throw new NotFoundException('CV not found on this case.');
    if (cv.status !== 'DRAFT') throw new ConflictException('This CV version is approved (locked). Regenerate to make a new editable version.');
    if (typeof content !== 'object' || content === null) throw new BadRequestException('content must be an object.');
    const updated = await this.prisma.cvDocument.update({ where: { id: cvId }, data: { contentJson: content as never, editedAt: new Date() } });
    return this.shape(updated);
  }

  async approve(caseId: string, cvId: string, actorId: string | null) {
    const cv = await this.prisma.cvDocument.findUnique({ where: { id: cvId } });
    if (!cv || cv.caseId !== caseId) throw new NotFoundException('CV not found on this case.');
    if (cv.status !== 'DRAFT') throw new ConflictException('Only a draft CV can be approved.');
    const updated = await this.prisma.cvDocument.update({
      where: { id: cvId }, data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
    });
    return this.shape(updated);
  }
}
