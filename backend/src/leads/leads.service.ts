import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto, isValidTransition } from './dto/update-lead-status.dto';
import { UpdateLeadNotesDto } from './dto/update-lead-notes.dto';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  async create(dto: CreateLeadDto) {
    // Verify contact exists
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

    // Emit lead created event
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

  async updateStatus(
    id: string,
    dto: UpdateLeadStatusDto,
    userId: string,
  ) {
    const lead = await this.findOne(id);

    // Validate transition
    if (!isValidTransition(lead.leadStatus as any, dto.status as any)) {
      throw new BadRequestException(
        `Invalid status transition from ${lead.leadStatus} to ${dto.status}`,
      );
    }

    // Check if disqualificationReason is provided when transitioning to DISQUALIFIED
    if (dto.status === 'DISQUALIFIED' && !dto.disqualificationReason) {
      throw new BadRequestException(
        'disqualificationReason is required when status is DISQUALIFIED',
      );
    }

    const updatedLead = await this.prisma.lead.update({
      where: { id },
      data: {
        leadStatus: dto.status as any,
        disqualificationReason:
          dto.status === 'DISQUALIFIED' ? dto.disqualificationReason : null,
      },
      include: { contact: true },
    });

    // Emit status change event
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

    return updatedLead;
  }

  async updateNotes(
    id: string,
    dto: UpdateLeadNotesDto,
    userId: string,
    userRole: string,
  ) {
    // Only SUPER_ADMIN can update notes
    if (userRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can update lead notes');
    }

    const lead = await this.findOne(id);

    // Create log entry
    await this.prisma.managerNotesLog.create({
      data: {
        leadId: id,
        previousValue: lead.managerNotes || '',
        newValue: dto.managerNotes,
        changedById: userId,
      },
    });

    // Update notes
    return this.prisma.lead.update({
      where: { id },
      data: { managerNotes: dto.managerNotes },
      include: { contact: true },
    });
  }
}
