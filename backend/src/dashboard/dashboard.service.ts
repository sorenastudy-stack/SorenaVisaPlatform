import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CommissionStatus, LeadStatus, ScoreBand } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  async getSummary() {
    const [totalLeads, leadStatusGroups, scoreBandGroups, activeSubscriptions, estimatedCommission, confirmedCommission, paidCommission, caseStageGroups, applicationStatusGroups, consultationsPending] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.groupBy({
        by: ['leadStatus'],
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['scoreBand'],
        _count: { _all: true },
      }),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE' },
      }),
      this.prisma.commission.aggregate({
        _sum: { estimatedAmountNZD: true },
      }),
      this.prisma.commission.aggregate({
        where: { status: 'CONFIRMED' },
        _sum: { actualAmountNZD: true },
      }),
      this.prisma.commission.aggregate({
        where: { status: 'PAID' },
        _sum: { actualAmountNZD: true },
      }),
      this.prisma.case.groupBy({
        by: ['stage'],
        _count: { _all: true },
      }),
      this.prisma.application.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.consultation.count({
        where: {
          status: 'PENDING',
        },
      }),
    ]);

    return {
      totalLeads,
      leadsByStatus: leadStatusGroups.map((group) => ({ status: group.leadStatus, count: group._count._all })),
      leadsByScoreBand: scoreBandGroups.map((group) => ({ scoreBand: group.scoreBand, count: group._count._all })),
      activeSubscriptions,
      totalCommissionEstimated: estimatedCommission._sum.estimatedAmountNZD || 0,
      totalCommissionConfirmed: confirmedCommission._sum.actualAmountNZD || 0,
      totalCommissionPaid: paidCommission._sum.actualAmountNZD || 0,
      consultationsPending,
      casesByStage: caseStageGroups.map((group) => ({ stage: group.stage, count: group._count._all })),
      applicationsByStatus: applicationStatusGroups.map((group) => ({ status: group.status, count: group._count._all })),
    };
  }

  async getLeadPipeline(filters: {
    status?: LeadStatus;
    scoreBand?: ScoreBand;
    ownerId?: string;
    country?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const where: any = {};

    if (filters.status) {
      where.leadStatus = filters.status;
    }

    if (filters.scoreBand) {
      where.scoreBand = filters.scoreBand;
    }

    if (filters.ownerId) {
      where.ownerId = filters.ownerId;
    }

    if (filters.country) {
      where.OR = [
        { contact: { countryOfResidence: filters.country } },
        { contact: { nationality: filters.country } },
      ];
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        if (!Number.isNaN(from.getTime())) {
          where.createdAt.gte = from;
        }
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        if (!Number.isNaN(to.getTime())) {
          where.createdAt.lte = to;
        }
      }
    }

    return this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leadStatus: true,
        readinessScore: true,
        scoreBand: true,
        executionAllowed: true,
        createdAt: true,
        contact: {
          select: { fullName: true },
        },
        owner: {
          select: { name: true },
        },
      },
    });
  }

  async getCommissions() {
    return this.prisma.commission.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        provider: { select: { name: true } },
        programme: { select: { name: true } },
      },
    });
  }

  async getCommissionReminders() {
    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + 30);

    return this.prisma.commission.findMany({
      where: {
        renewalReminderDate: {
          gte: now,
          lte: future,
        },
        reminderSent: false,
      },
      include: {
        provider: { select: { name: true } },
        programme: { select: { name: true } },
      },
    });
  }

  async confirmCommencement(id: string, actorId: string | null) {
    const commission = await this.prisma.commission.findUnique({
      where: { id },
      include: {
        application: {
          include: {
            case: true,
          },
        },
      },
    });

    if (!commission) {
      throw new NotFoundException('Commission not found');
    }

    const renewalReminderDate = new Date();
    renewalReminderDate.setFullYear(renewalReminderDate.getFullYear() + 1);

    const updated = await this.prisma.commission.update({
      where: { id },
      data: {
        status: CommissionStatus.CONFIRMED,
        confirmedAt: new Date(),
        renewalReminderDate,
      },
    });

    const leadId = commission.application?.case?.leadId || null;
    await this.eventsService.emit(
      'COMMISSION_CONFIRMED',
      'COMMISSION',
      id,
      leadId,
      'SYSTEM',
      actorId,
      { commissionId: id },
    );

    return updated;
  }

  async getProviders() {
    const providers = await this.prisma.educationProvider.findMany({
      orderBy: { name: 'asc' },
      include: {
        programmes: {
          where: { isActive: true },
          select: { id: true },
        },
      },
    });

    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      status: provider.status,
      commissionStructure: {
        year1: { type: provider.commissionY1Type, value: provider.commissionY1Value },
        year2: { type: provider.commissionY2Type, value: provider.commissionY2Value },
        bonus: provider.bonusType ? { type: provider.bonusType, value: provider.bonusValue } : null,
      },
      activeProgrammes: provider.programmes.length,
    }));
  }

  async getConsultations() {
    const now = new Date();

    return this.prisma.consultation.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          { scheduledAt: { gte: now } },
        ],
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
  }

  async getApplications() {
    return this.prisma.application.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        case: { select: { id: true, stage: true } },
        provider: { select: { name: true } },
        programme: { select: { name: true } },
      },
    });
  }
}
