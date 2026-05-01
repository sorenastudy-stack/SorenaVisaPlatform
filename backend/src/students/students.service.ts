import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private async getContactByUserId(userId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
    });
    if (!contact) {
      throw new NotFoundException('Student profile not found');
    }
    return contact;
  }

  async getProfile(userId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        nationality: true,
        countryOfResidence: true,
        preferredLanguage: true,
        lifecycleStage: true,
        photoUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!contact) {
      throw new NotFoundException('Student profile not found');
    }
    return contact;
  }

  async getCase(userId: string) {
    const contact = await this.getContactByUserId(userId);

    // Find the most recent lead for this contact
    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!lead) {
      return null;
    }

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      include: {
        applications: {
          include: {
            provider: {
              select: { id: true, name: true, providerType: true },
            },
            programme: {
              select: { id: true, name: true, level: true, durationMonths: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return caseRecord;
  }

  async getDocuments(userId: string) {
    const contact = await this.getContactByUserId(userId);

    // Find lead -> case -> applications -> documents
    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!lead) {
      return [];
    }

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!caseRecord) {
      return [];
    }

    const applications = await this.prisma.application.findMany({
      where: { caseId: caseRecord.id },
      include: {
        documents: true,
      },
    });

    return applications.flatMap((app) => app.documents);
  }

  async getTickets(userId: string) {
    const contact = await this.getContactByUserId(userId);

    return this.prisma.ticket.findMany({
      where: { contactId: contact.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            createdAt: true,
            isInternal: true,
            sender: {
              select: { id: true, name: true, role: true },
            },
          },
        },
        assignedTo: {
          select: { id: true, name: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getTicket(userId: string, ticketId: string) {
    const contact = await this.getContactByUserId(userId);

    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        contactId: contact.id,
      },
      include: {
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, name: true, role: true },
            },
          },
        },
        assignedTo: {
          select: { id: true, name: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  async createTicket(userId: string, subject: string, body: string) {
    if (!subject?.trim()) {
      throw new BadRequestException('subject is required');
    }
    if (!body?.trim()) {
      throw new BadRequestException('body is required');
    }

    const contact = await this.getContactByUserId(userId);

    // Find the user record to use as createdById
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const ticket = await this.prisma.ticket.create({
      data: {
        contactId: contact.id,
        subject: subject.trim(),
        createdById: userId,
        messages: {
          create: {
            senderId: userId,
            body: body.trim(),
            attachments: [],
            isInternal: false,
          },
        },
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, name: true, role: true },
            },
          },
        },
      },
    });

    return ticket;
  }

  async replyToTicket(userId: string, ticketId: string, body: string) {
    if (!body?.trim()) {
      throw new BadRequestException('body is required');
    }

    const contact = await this.getContactByUserId(userId);

    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        contactId: contact.id,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('Cannot reply to a closed ticket');
    }

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: userId,
        body: body.trim(),
        attachments: [],
        isInternal: false,
      },
      include: {
        sender: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    // Update ticket status to AWAITING_STAFF
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'AWAITING_STAFF' },
    });

    return message;
  }

  async getInvoices(userId: string) {
    const contact = await this.getContactByUserId(userId);

    return this.prisma.invoice.findMany({
      where: { contactId: contact.id },
      include: {
        payments: {
          select: {
            id: true,
            amount: true,
            currency: true,
            method: true,
            status: true,
            receivedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
