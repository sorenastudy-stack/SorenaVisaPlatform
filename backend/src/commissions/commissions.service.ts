import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';
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
    // PR-COMMISSIONS-UI — money-managing tier (OWNER/FINANCE + SUPER_ADMIN).
    if (!['OWNER', 'SUPER_ADMIN', 'FINANCE'].includes(userRole)) {
      throw new ForbiddenException('Only OWNER, FINANCE and SUPER_ADMIN can confirm commissions');
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
    // PR-COMMISSIONS-UI — money-managing tier (OWNER/FINANCE + SUPER_ADMIN).
    if (!['OWNER', 'SUPER_ADMIN', 'FINANCE'].includes(userRole)) {
      throw new ForbiddenException('Only OWNER, FINANCE and SUPER_ADMIN can update reminder dates');
    }

    await this.ensureCommissionExists(id);

    return this.prisma.commission.update({
      where: { id },
      data: { renewalReminderDate: dto.renewalReminderDate },
    });
  }

  // Who may read the commission ledger.
  //
  // An earlier note here said "your own commissions" was not expressible because
  // Commission has no per-user owner column. That was true of the column and
  // false of the model: a commission reaches a person through the lead behind it
  // (Commission → Application → Case → Lead.ownerId), which is exactly the
  // relation the scoped filter below walks.
  //
  // Enforced here in the service, not only on the controller, so no future
  // internal caller or new route can reach the ledger unscoped.
  static readonly VIEW_ROLES = ['OWNER', 'SUPER_ADMIN', 'FINANCE', 'SALES'];

  // Who sees the WHOLE ledger. SALES is deliberately absent: a salesperson sees
  // only the commissions arising from leads they own, and holds no write access
  // at all (create/confirm/status/reminder stay on the money-managing tier).
  static readonly LEDGER_OVERSIGHT_ROLES = ['OWNER', 'SUPER_ADMIN', 'FINANCE'];

  async findAll(
    query: CommissionListQueryDto,
    actor: {
      id?: string | null;
      name?: string | null;
      role?: string | null;
      secondaryRoles?: readonly string[] | null;
    },
  ) {
    if (!hasRole(actor, ...CommissionsService.VIEW_ROLES)) {
      throw new ForbiddenException('You are not allowed to view commissions.');
    }

    // Financial data — record every ledger read (money touch → audit).
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id ?? null,
        action: 'VIEW',
        eventType: 'COMMISSIONS_LEDGER_VIEWED',
        entityType: 'COMMISSION',
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.providerId) {
      where.providerId = query.providerId;
    }

    if (!hasRole(actor, ...CommissionsService.LEDGER_OVERSIGHT_ROLES)) {
      // A commission belongs to a salesperson through the lead they own:
      //   Commission → Application → Case → Lead → ownerId
      // There is no direct salesperson column, so the relation is walked rather
      // than denormalised — no migration, and it cannot drift out of sync with
      // who actually owns the lead.
      //
      // Applied last and unconditionally, so no query parameter can widen it.
      if (!actor.id) {
        throw new ForbiddenException('You are not allowed to view commissions.');
      }
      where.application = { case: { lead: { ownerId: actor.id } } };
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
