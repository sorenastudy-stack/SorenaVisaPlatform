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
