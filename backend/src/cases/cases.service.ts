import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { CaseListQueryDto } from './dto/case-list-filter.dto';

@Injectable()
export class CasesService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  async createCase(dto: CreateCaseDto, actorId: string | null) {
    // Check execution gate
    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (!lead.executionAllowed || lead.hardStopFlag) {
      throw new BadRequestException(
        'Lead does not pass execution gate: execution not allowed or hard stop flag is set',
      );
    }

    // Check if case already exists for this lead
    const existingCase = await this.prisma.case.findFirst({
      where: { leadId: dto.leadId },
    });

    if (existingCase) {
      throw new BadRequestException('Case already exists for this lead');
    }

    const caseRecord = await this.prisma.case.create({
      data: {
        leadId: dto.leadId,
        ownerId: lead.ownerId,
        riskLevel: lead.riskLevel,
      },
    });

    await this.eventsService.emit(
      'CASE_CREATED',
      'CASE',
      caseRecord.id,
      dto.leadId,
      EventSource.USER,
      actorId,
      { leadId: dto.leadId },
    );

    return caseRecord;
  }

  async findAll(query: CaseListQueryDto) {
    const where: any = {};

    if (query.stage) {
      where.stage = query.stage;
    }
    if (query.ownerId) {
      where.ownerId = query.ownerId;
    }

    return this.prisma.case.findMany({
      where,
      include: {
        lead: {
          include: { contact: true },
        },
        owner: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const caseRecord = await this.prisma.case.findUnique({
      where: { id },
      include: {
        lead: {
          include: { contact: true },
        },
        owner: true,
        applications: {
          include: {
            provider: true,
            programme: true,
            documents: true,
          },
        },
        contract: true,
      },
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    return caseRecord;
  }

  async updateCase(id: string, dto: UpdateCaseDto) {
    await this.ensureCaseExists(id);

    return this.prisma.case.update({
      where: { id },
      data: dto,
    });
  }

  private async ensureCaseExists(id: string) {
    const caseRecord = await this.prisma.case.findUnique({
      where: { id },
    });
    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    return caseRecord;
  }
}
