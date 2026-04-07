import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  async createApplication(dto: CreateApplicationDto) {
    // Validate programme
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: dto.programmeId },
    });

    if (!programme) {
      throw new NotFoundException('Programme not found');
    }

    if (programme.reviewStatus !== ReviewStatus.APPROVED || !programme.isActive) {
      throw new BadRequestException(
        'Programme is not approved or not active',
      );
    }

    // Validate case exists
    await this.ensureCaseExists(dto.caseId);

    // Validate provider matches programme
    if (programme.providerId !== dto.providerId) {
      throw new BadRequestException('Provider does not match programme');
    }

    const application = await this.prisma.application.create({
      data: dto,
    });

    await this.eventsService.emit(
      'APPLICATION_SUBMITTED',
      'APPLICATION',
      application.id,
      null,
      EventSource.USER,
      null,
      { caseId: dto.caseId, programmeId: dto.programmeId },
    );

    return application;
  }

  async findByCase(caseId: string) {
    await this.ensureCaseExists(caseId);

    return this.prisma.application.findMany({
      where: { caseId },
      include: {
        provider: true,
        programme: true,
        documents: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, dto: UpdateApplicationStatusDto, actorId: string | null) {
    const application = await this.ensureApplicationExists(id);

    // Validate transition
    if (!this.isValidStatusTransition(application.status, dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${application.status} to ${dto.status}`,
      );
    }

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        status: dto.status,
        ...this.getStatusTimestamps(dto.status),
      },
    });

    // Emit appropriate event
    const eventType = this.getEventTypeForStatus(dto.status);
    if (eventType) {
      await this.eventsService.emit(
        eventType,
        'APPLICATION',
        id,
        null,
        EventSource.USER,
        actorId,
        { newStatus: dto.status },
      );
    }

    return updated;
  }

  async addDocument(applicationId: string, dto: CreateDocumentDto) {
    await this.ensureApplicationExists(applicationId);

    return this.prisma.applicationDocument.create({
      data: {
        applicationId,
        ...dto,
      },
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

  private async ensureApplicationExists(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }

  private isValidStatusTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
    const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
      PREPARATION: [ApplicationStatus.SUBMITTED],
      SUBMITTED: [ApplicationStatus.OFFER_RECEIVED, ApplicationStatus.WITHDRAWN],
      OFFER_RECEIVED: [ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.WITHDRAWN],
      OFFER_ACCEPTED: [ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.WITHDRAWN],
      VISA_SUBMITTED: [ApplicationStatus.VISA_APPROVED, ApplicationStatus.VISA_DECLINED, ApplicationStatus.WITHDRAWN],
      VISA_APPROVED: [],
      VISA_DECLINED: [ApplicationStatus.SUBMITTED], // Can reapply
      WITHDRAWN: [],
    };

    return transitions[from]?.includes(to) ?? false;
  }

  private getStatusTimestamps(status: ApplicationStatus) {
    const now = new Date();
    switch (status) {
      case ApplicationStatus.SUBMITTED:
        return { submittedAt: now };
      case ApplicationStatus.OFFER_RECEIVED:
        return { offerReceivedAt: now };
      case ApplicationStatus.OFFER_ACCEPTED:
        return { offerAcceptedAt: now };
      case ApplicationStatus.VISA_SUBMITTED:
        return { visaSubmittedAt: now };
      case ApplicationStatus.VISA_APPROVED:
      case ApplicationStatus.VISA_DECLINED:
        return { visaDecisionAt: now };
      default:
        return {};
    }
  }

  private getEventTypeForStatus(status: ApplicationStatus): string | null {
    switch (status) {
      case ApplicationStatus.SUBMITTED:
        return 'APPLICATION_SUBMITTED';
      case ApplicationStatus.OFFER_RECEIVED:
        return 'OFFER_RECEIVED';
      case ApplicationStatus.VISA_APPROVED:
        return 'VISA_APPROVED';
      case ApplicationStatus.VISA_DECLINED:
        return 'VISA_DECLINED';
      default:
        return null;
    }
  }
}
