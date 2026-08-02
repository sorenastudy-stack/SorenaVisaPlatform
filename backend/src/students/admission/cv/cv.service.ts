import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CvGenerationAgent } from '../../../ai/agents/cv-generation.agent';
import { assembleCv, type CvSource } from './cv-content.logic';

// PR-ADMISSION-CV — the CV-document LIFECYCLE orchestrator (generate/review/edit/approve/version/
// lock). Generation itself lives in the CvGenerationAgent (ai/agents) — this service gathers the
// verified data, delegates the narrative to the agent, assembles it onto the deterministic
// factual sections, and persists a versioned CvDocument. The truthfulness guarantee lives in
// cv-content.logic (AI only writes summary/skills). Generation is GATED to submitted applications
// so the CV is localized to the programmes the client actually chose (shared finality point with
// Step 4 Sequential Submission). If the agent's AI is unavailable, the CV still generates from
// verified facts with an empty narrative the specialist writes themselves.
@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  constructor(private readonly prisma: PrismaService, private readonly cvAgent: CvGenerationAgent) {}

  private async gather(caseId: string): Promise<{ source: CvSource; applicationStatus: string | null }> {
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
        // The chosen programmes (localization) — the university/field the CV is tailored toward.
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
    const c = kase.lead?.contact;
    const source: CvSource = {
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
      targetProgrammes: (app?.programmeChoices ?? []).map((pc) => ({
        programmeName: pc.programme.name,
        providerName: pc.programme.provider?.name ?? null,
        field: pc.programme.studyFields[0]?.studyField?.nameEn ?? null,
        level: pc.programme.level ?? null,
      })),
    };
    return { source, applicationStatus: app?.status ?? null };
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
    const { source, applicationStatus } = await this.gather(caseId);
    // Gate: a CV must be localized to the CHOSEN programmes, so it only generates once the
    // client has submitted their choices (the shared finality point Step 4 also keys off).
    if (applicationStatus !== 'SUBMITTED' && applicationStatus !== 'LOCKED') {
      throw new BadRequestException('Generate the CV after the client submits their programme choices — it is tailored to the chosen field/university.');
    }

    // Narrative is the agent's job (owns the prompt + Claude call); it never throws.
    const { parts, available } = await this.cvAgent.generateNarrative(source);
    const aiUnavailable = !available;
    const content = assembleCv(source, parts);

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
