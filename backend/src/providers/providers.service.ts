import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionType,
  NZQFLevel,
  QualificationLevel,
  ProviderStatus,
  ProviderType,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { ProgrammeImportService } from './import/programme-import.service';
import { CatalogSyncService } from './websync/catalog-sync.service';
import { changeProposalToUpdate, type ChangedFields } from './websync/catalog-sync.logic';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { CreateProgrammeDto } from './dto/create-programme.dto';
import { ProviderListQueryDto } from './dto/provider-list-filter.dto';
import { ProgrammeListQueryDto } from './dto/programme-filter.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateScholarshipDto } from './dto/create-scholarship.dto';
import { UpdateScholarshipDto } from './dto/update-scholarship.dto';

@Injectable()
export class ProvidersService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private programmeImport: ProgrammeImportService,
    private catalogSync: CatalogSyncService,
  ) {}

  // PR-CATALOG-1 — Owner-panel Excel import for ONE institution. Runs the shared
  // importer with a fixed providerId → all programmes land PENDING, source
  // MANUAL_EXCEL, invisible to students until per-programme approval.
  async importProgrammes(providerId: string, file: { buffer?: Buffer; originalname?: string } | undefined, dryRun: boolean) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded.');
    const provider = await this.prisma.educationProvider.findUnique({ where: { id: providerId }, select: { id: true, institutionType: true } });
    if (!provider) throw new NotFoundException('Institution not found.');
    try {
      return await this.programmeImport.importFromXlsx(file.buffer, {
        institutionType: provider.institutionType ?? 'ITP',
        providerId,
        sourceRef: `upload-${provider.id}-${(file.originalname ?? 'file').replace(/[^\w.-]/g, '_')}`,
        dryRun,
      });
    } catch (e) {
      throw new BadRequestException(`Could not read the spreadsheet: ${(e as Error).message}`);
    }
  }

  // PR-CATALOG-1 — cross-institution pending-programme review queue.
  async pendingProgrammes() {
    const rows = await this.prisma.educationProgramme.findMany({
      where: { reviewStatus: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: {
        provider: { select: { id: true, name: true, status: true, institutionType: true } },
        studyFields: { take: 1, include: { studyField: { select: { key: true, nameEn: true } } } },
        _count: { select: { intakes: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id, name: p.name, level: p.level, nzqfLevel: p.nzqfLevel,
      campusCity: p.campusCity, tuitionFeeNZD: p.tuitionFeeNZD, currency: p.currency,
      source: p.source, sourceRef: p.sourceRef, createdAt: p.createdAt,
      provider: { id: p.provider.id, name: p.provider.name, status: p.provider.status, institutionType: p.provider.institutionType },
      studyField: p.studyFields[0]?.studyField ?? null,
      intakeCount: p._count.intakes,
    }));
  }

  // PR-CATALOG-2 — the ONE Owner review queue, unioning three PENDING kinds:
  //   programmes  — Excel-imported programmes awaiting first approval (existing).
  //   changes     — field changes the web check found on an approved programme.
  //   candidates  — new programmes the web check discovered (highest-confidence first).
  // Nothing here is visible to students until per-item approval.
  async reviewQueue() {
    const provider = { select: { id: true, name: true, status: true, institutionType: true } };
    const [programmes, changes, candidates] = await Promise.all([
      this.pendingProgrammes(),
      this.prisma.programmeChangeProposal.findMany({
        where: { status: 'PENDING' },
        orderBy: { detectedAt: 'desc' },
        include: { programme: { select: { id: true, name: true, campusCity: true, nzqfLevel: true, provider } } },
      }),
      this.prisma.programmeCandidate.findMany({
        where: { status: 'PENDING' },
        orderBy: [{ confidence: 'desc' }, { detectedAt: 'desc' }],
        include: { provider },
      }),
    ]);
    return {
      programmes,
      changes: changes.map((c) => ({
        id: c.id,
        programmeId: c.programmeId,
        programmeName: c.programme.name,
        campusCity: c.programme.campusCity,
        nzqfLevel: c.programme.nzqfLevel,
        changedFields: c.changedFields,
        sourceUrl: c.sourceUrl,
        detectedAt: c.detectedAt,
        provider: c.programme.provider,
      })),
      candidates: candidates.map((c) => {
        const prog = ((c.proposedData as any)?.programme ?? {}) as Record<string, unknown>;
        return {
          id: c.id,
          name: (prog.name as string) ?? '(unnamed)',
          level: (prog.level as string) ?? null,
          nzqfLevel: c.nzqfLevel,
          campusCity: c.campusCity,
          tuitionFeeNZD: (prog.tuitionFeeNZD as number) ?? null,
          studyFieldKey: ((c.proposedData as any)?.studyFieldKey as string) ?? null,
          detectedFields: c.detectedFields,
          confidence: c.confidence,
          sourceUrl: c.sourceUrl,
          detectedAt: c.detectedAt,
          provider: c.provider,
        };
      }),
    };
  }

  // Manual "sync now" for one institution (Owner) — the same sweep the monthly cron runs,
  // scoped to this provider. Returns the run report so the Owner sees what it found.
  async syncNow(providerId: string) {
    await this.ensureProviderExists(providerId);
    return this.catalogSync.runSweep({ providerId });
  }

  // Approve a web-detected field change → apply it to the live (already-approved) programme.
  async approveChange(id: string, actorId: string | null) {
    const proposal = await this.prisma.programmeChangeProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Change proposal not found');
    if (proposal.status !== 'PENDING') throw new BadRequestException('Change proposal already reviewed');

    const update = changeProposalToUpdate(proposal.changedFields as ChangedFields);
    await this.prisma.$transaction([
      this.prisma.educationProgramme.update({ where: { id: proposal.programmeId }, data: update }),
      this.prisma.programmeChangeProposal.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: actorId, reviewedAt: new Date() },
      }),
    ]);
    await this.eventsService.emit(
      'PROGRAMME_UPDATED', 'EDUCATION_PROGRAMME', proposal.programmeId, null,
      EventSource.USER, actorId, { via: 'web-sync change', fields: Object.keys(update) },
    );
    return { ok: true };
  }

  async rejectChange(id: string, actorId: string | null) {
    const proposal = await this.prisma.programmeChangeProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Change proposal not found');
    if (proposal.status !== 'PENDING') throw new BadRequestException('Change proposal already reviewed');
    await this.prisma.programmeChangeProposal.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: actorId, reviewedAt: new Date() },
    });
    return { ok: true };
  }

  // Approve a discovered new-programme candidate → materialise a real APPROVED programme via
  // the same shape the Excel importer produces (proposedData.programme). Rejecting keeps the
  // row REJECTED so the dedupe never re-surfaces it next sweep.
  async approveCandidate(id: string, actorId: string | null) {
    const cand = await this.prisma.programmeCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException('Candidate not found');
    if (cand.status !== 'PENDING') throw new BadRequestException('Candidate already reviewed');

    const data = (cand.proposedData as any)?.programme as Record<string, any> | undefined;
    if (!data?.name) throw new BadRequestException('Candidate has no usable programme data');
    const studyFieldKey = (cand.proposedData as any)?.studyFieldKey as string | undefined;
    const intakes = ((cand.proposedData as any)?.intakes ?? []) as Array<Record<string, any>>;

    const created = await this.prisma.$transaction(async (tx) => {
      const prog = await tx.educationProgramme.create({
        // proposedData is dynamic JSON (rowToProgrammeData output incl. providerId/name/
        // level/nzqfLevel) — the fields are all present at runtime; cast past the static check.
        data: {
          ...data,
          verifiedAt: data.verifiedAt ? new Date(data.verifiedAt) : null,
          reviewStatus: ReviewStatus.APPROVED,
          isActive: true,
        } as any,
      });
      if (studyFieldKey) {
        const sf = await tx.studyField.findFirst({ where: { key: studyFieldKey }, select: { id: true } });
        if (sf) {
          await tx.programmeStudyField.create({ data: { programmeId: prog.id, studyFieldId: sf.id, isPrimary: true } });
        }
      }
      if (intakes.length) {
        await tx.programmeIntake.createMany({ data: intakes.map((it) => ({ ...it, programmeId: prog.id })) as any });
      }
      await tx.programmeCandidate.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: actorId, reviewedAt: new Date() },
      });
      return prog;
    });

    await this.eventsService.emit(
      'PROGRAMME_CREATED', 'EDUCATION_PROGRAMME', created.id, null,
      EventSource.USER, actorId, { via: 'web-sync candidate', programmeName: created.name },
    );
    return created;
  }

  async rejectCandidate(id: string, actorId: string | null) {
    const cand = await this.prisma.programmeCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException('Candidate not found');
    if (cand.status !== 'PENDING') throw new BadRequestException('Candidate already reviewed');
    await this.prisma.programmeCandidate.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: actorId, reviewedAt: new Date() },
    });
    return { ok: true };
  }

  async createProvider(dto: CreateProviderDto, actorId: string | null) {
    const provider = await this.prisma.educationProvider.create({
      data: dto,
    });

    await this.eventsService.emit(
      'PROVIDER_CREATED',
      'EDUCATION_PROVIDER',
      provider.id,
      null,
      EventSource.USER,
      actorId,
      { providerName: provider.name },
    );

    return provider;
  }

  async findAll(query: ProviderListQueryDto) {
    const where: any = {};

    if (query.providerType) {
      where.providerType = query.providerType;
    }
    if (query.status) {
      where.status = query.status;
    }

    return this.prisma.educationProvider.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id },
      include: {
        faculties: true,
        programmes: {
          include: {
            requirements: true,
          },
        },
      },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    return provider;
  }

  async updateProvider(id: string, dto: UpdateProviderDto) {
    await this.ensureProviderExists(id);

    return this.prisma.educationProvider.update({
      where: { id },
      data: dto,
    });
  }

  async updateAgreement(id: string, dto: UpdateAgreementDto) {
    await this.ensureProviderExists(id);

    return this.prisma.educationProvider.update({
      where: { id },
      data: dto,
    });
  }

  async addFaculty(providerId: string, dto: CreateFacultyDto) {
    await this.ensureProviderExists(providerId);

    return this.prisma.educationFaculty.create({
      data: {
        providerId,
        name: dto.name,
      },
    });
  }

  async findFaculties(providerId: string) {
    await this.ensureProviderExists(providerId);

    return this.prisma.educationFaculty.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addProgramme(providerId: string, dto: CreateProgrammeDto) {
    await this.ensureProviderExists(providerId);

    if (dto.facultyId) {
      const faculty = await this.prisma.educationFaculty.findUnique({
        where: { id: dto.facultyId },
      });
      if (!faculty || faculty.providerId !== providerId) {
        throw new BadRequestException('Faculty does not belong to the provider');
      }
    }

    return this.prisma.educationProgramme.create({
      data: {
        providerId,
        facultyId: dto.facultyId,
        name: dto.name,
        level: dto.level,
        nzqfLevel: dto.nzqfLevel,
        durationMonths: dto.durationMonths,
        tuitionFeeNZD: dto.tuitionFeeNZD,
        intakeMonths: dto.intakeMonths,
        reviewStatus: ReviewStatus.PENDING,
        isActive: false,
      },
    });
  }

  async findProgrammes(providerId: string, query: ProgrammeListQueryDto) {
    await this.ensureProviderExists(providerId);

    const where: any = { providerId };
    if (query.level) {
      where.level = query.level;
    }
    if (query.reviewStatus) {
      where.reviewStatus = query.reviewStatus;
    }

    return this.prisma.educationProgramme.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        faculty: true,
        requirements: true,
      },
    });
  }

  async approveProgramme(programmeId: string, actorId: string | null) {
    const programme = await this.ensureProgrammeExists(programmeId);

    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: {
        reviewStatus: ReviewStatus.APPROVED,
        isActive: true,
      },
    });

    await this.eventsService.emit(
      'PROGRAMME_APPROVED',
      'EDUCATION_PROGRAMME',
      programmeId,
      null,
      EventSource.USER,
      actorId,
      { programmeName: programme.name },
    );

    return updated;
  }

  async rejectProgramme(programmeId: string, actorId: string | null) {
    const programme = await this.ensureProgrammeExists(programmeId);

    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: {
        reviewStatus: ReviewStatus.REJECTED,
      },
    });

    await this.eventsService.emit(
      'PROGRAMME_REJECTED',
      'EDUCATION_PROGRAMME',
      programmeId,
      null,
      EventSource.USER,
      actorId,
      { programmeName: programme.name },
    );

    return updated;
  }

  async addRequirement(programmeId: string, dto: CreateRequirementDto) {
    await this.ensureProgrammeExists(programmeId);

    const existing = await this.prisma.programmeRequirement.findUnique({
      where: { programmeId },
    });
    if (existing) {
      throw new BadRequestException('Requirements already exist for this programme');
    }

    return this.prisma.programmeRequirement.create({
      data: {
        programmeId,
        minQualificationLevel: dto.minQualificationLevel,
        minGpa: dto.minGpa,
        englishTestType: dto.englishTestType,
        englishOverallMin: dto.englishOverallMin,
        englishComponentMins: dto.englishComponentMins,
        workExperienceRequired: dto.workExperienceRequired,
        portfolioRequired: dto.portfolioRequired,
        interviewRequired: dto.interviewRequired,
        documentsRequired: dto.documentsRequired,
        additionalNotes: dto.additionalNotes,
      },
    });
  }

  async findRequirement(programmeId: string) {
    await this.ensureProgrammeExists(programmeId);

    const requirements = await this.prisma.programmeRequirement.findUnique({
      where: { programmeId },
    });

    if (!requirements) {
      throw new NotFoundException('Requirements not found');
    }

    return requirements;
  }

  // ── Scholarships (PR-UNIVERSITIES) ──────────────────────────────────────
  // Owner-managed reference data: what Sorena can offer per provider, scoped by
  // applicant nationality and (optionally) a programme or qualification level.

  async findScholarships(providerId: string) {
    await this.ensureProviderExists(providerId);
    return this.prisma.providerScholarship.findMany({
      where: { providerId },
      orderBy: [{ isActive: 'desc' }, { nationality: 'asc' }, { createdAt: 'desc' }],
      include: { programme: { select: { id: true, name: true, level: true } } },
    });
  }

  async addScholarship(providerId: string, dto: CreateScholarshipDto, actorId: string | null) {
    await this.ensureProviderExists(providerId);
    await this.assertProgrammeBelongsToProvider(dto.programmeId, providerId);

    const scholarship = await this.prisma.providerScholarship.create({
      data: {
        providerId,
        nationality: dto.nationality.trim().toUpperCase(),
        programmeId: dto.programmeId ?? null,
        level: dto.level ?? null,
        name: dto.name.trim(),
        amountType: dto.amountType ?? CommissionType.FIXED,
        amountValue: dto.amountValue,
        currency: dto.currency?.trim().toUpperCase() ?? 'NZD',
        eligibilityNotes: dto.eligibilityNotes?.trim() || null,
        isActive: dto.isActive ?? true,
        updatedById: actorId,
      },
    });

    await this.eventsService.emit(
      'SCHOLARSHIP_CREATED',
      'PROVIDER_SCHOLARSHIP',
      scholarship.id,
      null,
      EventSource.USER,
      actorId,
      { providerId, nationality: scholarship.nationality, name: scholarship.name },
    );

    return scholarship;
  }

  async updateScholarship(scholarshipId: string, dto: UpdateScholarshipDto, actorId: string | null) {
    const existing = await this.ensureScholarshipExists(scholarshipId);
    if (dto.programmeId !== undefined) {
      await this.assertProgrammeBelongsToProvider(dto.programmeId, existing.providerId);
    }

    const scholarship = await this.prisma.providerScholarship.update({
      where: { id: scholarshipId },
      data: {
        ...(dto.nationality !== undefined ? { nationality: dto.nationality.trim().toUpperCase() } : {}),
        ...(dto.programmeId !== undefined ? { programmeId: dto.programmeId ?? null } : {}),
        ...(dto.level !== undefined ? { level: dto.level ?? null } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.amountType !== undefined ? { amountType: dto.amountType } : {}),
        ...(dto.amountValue !== undefined ? { amountValue: dto.amountValue } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency?.trim().toUpperCase() ?? 'NZD' } : {}),
        ...(dto.eligibilityNotes !== undefined ? { eligibilityNotes: dto.eligibilityNotes?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedById: actorId,
      },
    });

    await this.eventsService.emit(
      'SCHOLARSHIP_UPDATED',
      'PROVIDER_SCHOLARSHIP',
      scholarshipId,
      null,
      EventSource.USER,
      actorId,
      { providerId: existing.providerId },
    );

    return scholarship;
  }

  async deleteScholarship(scholarshipId: string, actorId: string | null) {
    const existing = await this.ensureScholarshipExists(scholarshipId);
    await this.prisma.providerScholarship.delete({ where: { id: scholarshipId } });

    await this.eventsService.emit(
      'SCHOLARSHIP_DELETED',
      'PROVIDER_SCHOLARSHIP',
      scholarshipId,
      null,
      EventSource.USER,
      actorId,
      { providerId: existing.providerId, name: existing.name },
    );

    return { id: scholarshipId, deleted: true };
  }

  // A programme reference (when given) must belong to the same provider.
  private async assertProgrammeBelongsToProvider(programmeId: string | null | undefined, providerId: string) {
    if (!programmeId) return;
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: programmeId },
      select: { providerId: true },
    });
    if (!programme || programme.providerId !== providerId) {
      throw new BadRequestException('Programme does not belong to this provider');
    }
  }

  private async ensureScholarshipExists(id: string) {
    const scholarship = await this.prisma.providerScholarship.findUnique({ where: { id } });
    if (!scholarship) {
      throw new NotFoundException('Scholarship not found');
    }
    return scholarship;
  }

  private async ensureProviderExists(id: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id },
    });
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }
    return provider;
  }

  private async ensureProgrammeExists(id: string) {
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id },
    });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
    return programme;
  }
}
