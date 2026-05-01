import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { LeadStatus, LeadStatusHistory } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto, isValidTransition } from './dto/update-lead-status.dto';
import { UpdateLeadNotesDto } from './dto/update-lead-notes.dto';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateLeadDto) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: dto.contactId },
    });

    if (!contact || contact.archivedAt) {
      throw new BadRequestException('Contact not found');
    }

    const lead = await this.prisma.lead.create({
      data: {
        contactId: dto.contactId,
        ownerId: dto.ownerId || null,
        leadStatus: 'NEW',
      },
      include: { contact: true },
    });

    await this.eventsService.emit(
      'LEAD_CREATED',
      'LEAD',
      lead.id,
      lead.id,
      'SYSTEM',
      null,
      { contactId: contact.id },
    );

    return lead;
  }

  async findAll(filters: {
    status?: string;
    scoreBand?: string;
    ownerId?: string;
    isNurtureCandidate?: boolean;
  }) {
    const where: any = {};

    if (filters.status) where.leadStatus = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.isNurtureCandidate !== undefined)
      where.isNurtureCandidate = filters.isNurtureCandidate;

    return this.prisma.lead.findMany({
      where,
      include: { contact: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: { contact: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  async updateStatus(id: string, dto: UpdateLeadStatusDto, userId: string) {
    const lead = await this.findOne(id);

    if (!isValidTransition(lead.leadStatus as any, dto.status as any)) {
      throw new BadRequestException(
        `Invalid status transition from ${lead.leadStatus} to ${dto.status}`,
      );
    }

    if (dto.status === 'DISQUALIFIED' && !dto.disqualificationReason) {
      throw new BadRequestException(
        'disqualificationReason is required when status is DISQUALIFIED',
      );
    }

    const [updatedLead] = await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id },
        data: {
          leadStatus: dto.status as any,
          disqualificationReason:
            dto.status === 'DISQUALIFIED' ? dto.disqualificationReason : null,
        },
        include: { contact: true },
      }),
      this.prisma.leadStatusHistory.create({
        data: {
          leadId: id,
          fromStatus: lead.leadStatus as LeadStatus,
          toStatus: dto.status as LeadStatus,
          changedById: userId,
          reason: dto.disqualificationReason ?? null,
          isOverride: false,
          isUndo: false,
        },
      }),
    ]);

    await this.eventsService.emit(
      'LEAD_STATUS_CHANGED',
      'LEAD',
      id,
      id,
      'USER',
      userId,
      {
        previousStatus: lead.leadStatus,
        newStatus: dto.status,
        reason: dto.disqualificationReason,
      },
    );

    // Auto-provision student account when lead becomes QUALIFIED
    if (dto.status === 'QUALIFIED') {
      await this.provisionStudentAccount(id, updatedLead.contact as any);
    }

    return updatedLead;
  }

  private async provisionStudentAccount(
    leadId: string,
    contact: { id: string; email: string | null; fullName: string; userId?: string | null },
  ): Promise<void> {
    // Re-fetch contact to get latest userId
    const freshContact = await this.prisma.contact.findUnique({
      where: { id: contact.id },
      select: { id: true, userId: true, email: true, fullName: true },
    });

    if (!freshContact) return;
    if (freshContact.userId) {
      this.logger.log(`Contact ${freshContact.id} already has a student account — skipping`);
      return;
    }

    if (!freshContact.email) {
      this.logger.warn(`Contact ${freshContact.id} has no email — cannot create student account`);
      return;
    }

    const rawPassword = randomBytes(9).toString('base64').slice(0, 12);
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        name: freshContact.fullName,
        email: freshContact.email,
        passwordHash,
        role: 'STUDENT',
      },
    });

    await this.prisma.contact.update({
      where: { id: freshContact.id },
      data: { userId: user.id },
    });

    // Ensure a Case exists for this lead
    const existingCase = await this.prisma.case.findFirst({
      where: { leadId },
    });

    if (!existingCase) {
      await this.prisma.case.create({
        data: {
          leadId,
          stage: 'ADMISSION',
          status: 'active',
        },
      });
    }

    // Send welcome email — failure is non-fatal
    try {
      await this.notificationsService.sendWelcomeEmail(
        freshContact.email,
        freshContact.fullName,
      );
    } catch (err) {
      console.warn(`Welcome email failed for ${freshContact.email}:`, err);
    }

    this.logger.log(`Student account provisioned for contact ${freshContact.id} (user ${user.id})`);
  }

  async overrideStatus(
    leadId: string,
    newStatus: LeadStatus,
    reason: string,
    userId: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('reason is required for status override');
    }

    const lead = await this.findOne(leadId);

    const [updatedLead] = await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id: leadId },
        data: { leadStatus: newStatus },
        include: { contact: true },
      }),
      this.prisma.leadStatusHistory.create({
        data: {
          leadId,
          fromStatus: lead.leadStatus as LeadStatus,
          toStatus: newStatus,
          changedById: userId,
          reason: reason.trim(),
          isOverride: true,
          isUndo: false,
        },
      }),
    ]);

    return updatedLead;
  }

  async undoLastChange(leadId: string, userId: string) {
    const last = await this.prisma.leadStatusHistory.findFirst({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });

    if (!last) {
      throw new NotFoundException('No status change to undo');
    }

    const ageMs = Date.now() - last.createdAt.getTime();
    if (ageMs > 60_000) {
      throw new BadRequestException('Undo window expired (60 seconds)');
    }

    if (last.changedById !== userId) {
      throw new ForbiddenException('Can only undo your own changes');
    }

    if (last.isUndo) {
      throw new BadRequestException('Already undone');
    }

    if (!last.fromStatus) {
      throw new BadRequestException('Cannot undo the original creation');
    }

    const lead = await this.findOne(leadId);

    const [updatedLead] = await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id: leadId },
        data: { leadStatus: last.fromStatus },
        include: { contact: true },
      }),
      this.prisma.leadStatusHistory.create({
        data: {
          leadId,
          fromStatus: lead.leadStatus as LeadStatus,
          toStatus: last.fromStatus,
          changedById: userId,
          reason: 'Undo of previous change',
          isOverride: false,
          isUndo: true,
        },
      }),
    ]);

    return updatedLead;
  }

  async getHistory(leadId: string): Promise<LeadStatusHistory[]> {
    return this.prisma.leadStatusHistory.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        changedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async updateNotes(
    id: string,
    dto: UpdateLeadNotesDto,
    userId: string,
    userRole: string,
  ) {
    if (userRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can update lead notes');
    }

    const lead = await this.findOne(id);

    await this.prisma.managerNotesLog.create({
      data: {
        leadId: id,
        previousValue: lead.managerNotes || '',
        newValue: dto.managerNotes,
        changedById: userId,
      },
    });

    return this.prisma.lead.update({
      where: { id },
      data: { managerNotes: dto.managerNotes },
      include: { contact: true },
    });
  }
}
