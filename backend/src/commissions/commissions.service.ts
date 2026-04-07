import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';
import { UpdateReminderDateDto } from './dto/update-reminder-date.dto';
import { CommissionListQueryDto } from './dto/commission-list-filter.dto';

@Injectable()
export class CommissionsService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  async createCommission(dto: CreateCommissionDto) {
    // Validate application exists and doesn't already have commission
    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      include: { commission: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (application.commission) {
      throw new BadRequestException('Commission already exists for this application');
    }

    // Validate provider and programme match application
    if (application.providerId !== dto.providerId || application.programmeId !== dto.programmeId) {
      throw new BadRequestException('Provider or programme does not match application');
    }

    return this.prisma.commission.create({
      data: dto,
    });
  }

  async confirmCommission(id: string, actorId: string | null, userRole: string) {
    if (!['OPERATIONS', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Only OPERATIONS and SUPER_ADMIN can confirm commissions');
    }

    const commission = await this.ensureCommissionExists(id);

    if (commission.status !== CommissionStatus.ESTIMATED) {
      throw new BadRequestException('Commission must be in ESTIMATED status to confirm');
    }

    const confirmedAt = new Date();
    const renewalReminderDate = new Date(confirmedAt);
    renewalReminderDate.setFullYear(renewalReminderDate.getFullYear() + 1);

    const updated = await this.prisma.commission.update({
      where: { id },
      data: {
        status: CommissionStatus.CONFIRMED,
        confirmedAt,
        renewalReminderDate,
      },
    });

    await this.eventsService.emit(
      'COMMISSION_CONFIRMED',
      'COMMISSION',
      id,
      null,
      EventSource.USER,
      actorId,
      { confirmedAt, renewalReminderDate },
    );

    return updated;
  }

  async updateReminderDate(id: string, dto: UpdateReminderDateDto, userRole: string) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Only ADMIN and SUPER_ADMIN can update reminder dates');
    }

    await this.ensureCommissionExists(id);

    return this.prisma.commission.update({
      where: { id },
      data: { renewalReminderDate: dto.renewalReminderDate },
    });
  }

  async findAll(query: CommissionListQueryDto) {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.providerId) {
      where.providerId = query.providerId;
    }

    return this.prisma.commission.findMany({
      where,
      include: {
        application: {
          include: {
            case: {
              include: {
                lead: {
                  include: { contact: true },
                },
              },
            },
          },
        },
        provider: true,
        programme: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, dto: UpdateCommissionStatusDto) {
    const commission = await this.ensureCommissionExists(id);

    // Validate transition
    if (!this.isValidStatusTransition(commission.status, dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${commission.status} to ${dto.status}`,
      );
    }

    const updateData: any = { status: dto.status };

    if (dto.status === CommissionStatus.INVOICED) {
      updateData.invoiceSentAt = new Date();
    } else if (dto.status === CommissionStatus.PAID) {
      updateData.paidAt = new Date();
    }

    return this.prisma.commission.update({
      where: { id },
      data: updateData,
    });
  }

  private async ensureCommissionExists(id: string) {
    const commission = await this.prisma.commission.findUnique({
      where: { id },
    });
    if (!commission) {
      throw new NotFoundException('Commission not found');
    }
    return commission;
  }

  private isValidStatusTransition(from: CommissionStatus, to: CommissionStatus): boolean {
    const transitions: Record<CommissionStatus, CommissionStatus[]> = {
      ESTIMATED: [CommissionStatus.CONFIRMED, CommissionStatus.CANCELLED],
      CONFIRMED: [CommissionStatus.INVOICED, CommissionStatus.CANCELLED],
      INVOICED: [CommissionStatus.PAID, CommissionStatus.CANCELLED],
      PAID: [],
      CANCELLED: [],
    };

    return transitions[from]?.includes(to) ?? false;
  }
}
