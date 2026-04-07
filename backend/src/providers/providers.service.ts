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
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { CreateProgrammeDto } from './dto/create-programme.dto';
import { ProviderListQueryDto } from './dto/provider-list-filter.dto';
import { ProgrammeListQueryDto } from './dto/programme-filter.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';

@Injectable()
export class ProvidersService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

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
