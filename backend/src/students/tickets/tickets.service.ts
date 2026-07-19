import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { R2Service } from '../../common/r2/r2.service';

// PR-DASH-2 — Client-facing tickets service.
//
// Ownership model: every read AND every mutation goes through a
// resolveCase(userId) helper that walks Contact → Lead → Case →
// AdmissionApplication → VisaApplication → VisaCase (the same chain
// dashboard.service uses). Once we have the user's VisaCase id, the
// ticket queries filter by clientId AND caseId so a leaky parameter
// can't reach another client's data.
//
// "Not owned" responses return HTTP 404 (not 403) so the API doesn't
// leak whether a given ticket id exists at all.
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly r2: R2Service,
  ) {}

  // PR-TICKETS-RICH — mint short-lived signed URLs for a message's stored
  // attachments (image/PDF uploaded by staff). The R2 key is never exposed.
  private async signAttachments(
    raw: unknown,
  ): Promise<Array<{ name: string; mime: string; size: number; url: string | null }>> {
    if (!Array.isArray(raw)) return [];
    return Promise.all(
      (raw as Array<{ key: string; name: string; mime: string; size: number }>).map(async (a) => {
        let url: string | null = null;
        try { url = await this.r2.getPresignedDownloadUrl(a.key, 3600); } catch { url = null; }
        return { name: a.name, mime: a.mime, size: a.size, url };
      }),
    );
  }

  private async resolveCase(userId: string) {
    const contact = await this.prisma.contact.findUnique({ where: { userId } });
    if (!contact) throw new NotFoundException('Student profile not found');

    const lead = await this.prisma.lead.findFirst({
      where:   { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) throw new NotFoundException('No lead found for this student');

    const crmCase = await this.prisma.case.findFirst({
      where:   { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!crmCase) throw new NotFoundException('No case found for this student');

    const admission = await this.prisma.admissionApplication.findFirst({
      where:   { caseId: crmCase.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!admission) throw new NotFoundException('No admission application found');

    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) throw new NotFoundException('No visa application found');

    const visaCase = await this.prisma.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
    });
    if (!visaCase) throw new NotFoundException('No visa case found — open the dashboard first');

    return visaCase;
  }

  private shortId(id: string): string {
    return id.replace(/-/g, '').slice(0, 8);
  }

  private dec(b: Buffer | Uint8Array | null | undefined): string {
    if (!b) return '';
    return this.crypto.decrypt(Buffer.isBuffer(b) ? b : Buffer.from(b));
  }

  // GET /students/me/tickets
  async listTickets(
    userId: string,
    filters: { statuses?: string[]; departments?: string[] },
  ) {
    const visaCase = await this.resolveCase(userId);
    const where: Record<string, unknown> = {
      clientId: userId,
      caseId:   visaCase.id,
    };
    if (filters.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }
    if (filters.departments && filters.departments.length > 0) {
      where.department = { in: filters.departments };
    }

    const rows = await this.prisma.visaSupportTicket.findMany({
      where: where as never,
      // Match the spec sort: most recent staff reply first, then
      // client reply, then creation time. Nulls last on the first
      // two so brand-new tickets without a staff response still
      // float toward the top.
      orderBy: [
        { lastStaffMessageAt:  { sort: 'desc', nulls: 'last' } },
        { lastClientMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt:           'desc' },
      ],
      include: {
        _count: {
          select: { messages: { where: { isInternalNote: false } } },
        },
      },
    });

    return rows.map((r) => ({
      id:                  r.id,
      subject:             this.dec(r.subjectEncrypted),
      department:          r.department,
      status:              r.status,
      priority:            r.priority,
      messageCount:        r._count.messages,
      lastStaffMessageAt:  r.lastStaffMessageAt,
      lastClientMessageAt: r.lastClientMessageAt,
      createdAt:           r.createdAt,
      updatedAt:           r.updatedAt,
    }));
  }

  // GET /students/me/tickets/:id
  async getTicket(userId: string, ticketId: string) {
    const visaCase = await this.resolveCase(userId);
    const ticket = await this.prisma.visaSupportTicket.findFirst({
      where: { id: ticketId, clientId: userId, caseId: visaCase.id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const messages = await this.prisma.visaSupportTicketMessage.findMany({
      where:   { ticketId: ticket.id, isInternalNote: false },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });

    return {
      id:                  ticket.id,
      subject:             this.dec(ticket.subjectEncrypted),
      department:          ticket.department,
      status:              ticket.status,
      priority:            ticket.priority,
      createdAt:           ticket.createdAt,
      resolvedAt:          ticket.resolvedAt,
      closedAt:            ticket.closedAt,
      lastClientMessageAt: ticket.lastClientMessageAt,
      lastStaffMessageAt:  ticket.lastStaffMessageAt,
      messages: await Promise.all(messages.map(async (m) => ({
        id:                m.id,
        authorRole:        m.authorRole,
        body:              this.dec(m.bodyEncrypted),
        // Staff replies are sanitized HTML (bodyIsHtml=true); client/legacy
        // messages are plain text. The client UI renders accordingly.
        bodyIsHtml:        m.bodyIsHtml,
        attachments:       await this.signAttachments(m.attachments),
        createdAt:         m.createdAt,
        authorDisplayName: this.displayName(m, userId),
      }))),
    };
  }

  private displayName(
    m: { authorId: string; authorRole: string; author: { name: string } | null },
    userId: string,
  ): string {
    if (m.authorRole === 'SYSTEM') return 'System';
    if (m.authorId === userId) return 'You';
    const name = (m.author?.name ?? '').trim();
    if (!name) return 'Staff';
    const parts = name.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
  }

  // POST /students/me/tickets
  async createTicket(
    userId: string,
    body: { department: string; subject: string; initialMessage: string },
  ) {
    const visaCase = await this.resolveCase(userId);

    const subject = (body.subject ?? '').trim();
    const initialMessage = (body.initialMessage ?? '').trim();
    if (subject === '') throw new BadRequestException('tickets.validation.subjectRequired');
    if (initialMessage === '') throw new BadRequestException('tickets.validation.messageRequired');

    const subjectEncrypted = this.crypto.encrypt(subject);
    const bodyEncrypted    = this.crypto.encrypt(initialMessage);

    // Single transaction: ticket + first message + file note + audit
    // row. If any step fails the row count stays consistent.
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.visaSupportTicket.create({
        data: {
          clientId:            userId,
          caseId:              visaCase.id,
          department:          body.department as never,
          subjectEncrypted:    subjectEncrypted as never,
          status:              'OPEN',
          priority:            'NORMAL',
          lastClientMessageAt: new Date(),
        },
      });
      await tx.visaSupportTicketMessage.create({
        data: {
          ticketId:      ticket.id,
          authorId:      userId,
          authorRole:    'CLIENT',
          bodyEncrypted: bodyEncrypted as never,
        },
      });
      const summary = `Ticket opened — ${body.department}: "${subject.slice(0, 80)}"`;
      await tx.visaCaseFileNote.create({
        data: {
          caseId:           visaCase.id,
          noteType:         'TICKET',
          referenceId:      ticket.id,
          summaryEncrypted: this.crypto.encrypt(summary) as never,
          createdById:      userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action:     'TICKET_CREATED',
          eventType:  'TICKET_CREATED',
          entityType: 'VisaSupportTicket',
          entityId:   ticket.id,
          newValue:   { department: body.department, status: 'OPEN' },
        },
      });
      return { id: ticket.id };
    });
  }

  // POST /students/me/tickets/:id/messages
  async addMessage(userId: string, ticketId: string, body: { body: string }) {
    const visaCase = await this.resolveCase(userId);
    const ticket = await this.prisma.visaSupportTicket.findFirst({
      where: { id: ticketId, clientId: userId, caseId: visaCase.id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('tickets.errors.closedTicket');
    }

    const text = (body.body ?? '').trim();
    if (text === '') throw new BadRequestException('tickets.validation.messageRequired');

    const bodyEncrypted = this.crypto.encrypt(text);

    return this.prisma.$transaction(async (tx) => {
      const msg = await tx.visaSupportTicketMessage.create({
        data: {
          ticketId:      ticket.id,
          authorId:      userId,
          authorRole:    'CLIENT',
          bodyEncrypted: bodyEncrypted as never,
        },
      });
      await tx.visaSupportTicket.update({
        where: { id: ticket.id },
        data:  { lastClientMessageAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action:     'TICKET_MESSAGE_SENT',
          eventType:  'TICKET_MESSAGE_SENT',
          entityType: 'VisaSupportTicket',
          entityId:   ticket.id,
        },
      });
      return { id: msg.id, createdAt: msg.createdAt };
    });
  }

  // PATCH /students/me/tickets/:id/close
  async closeTicket(userId: string, ticketId: string) {
    const visaCase = await this.resolveCase(userId);
    const ticket = await this.prisma.visaSupportTicket.findFirst({
      where: { id: ticketId, clientId: userId, caseId: visaCase.id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED') {
      // Idempotent — already closed.
      return { id: ticket.id, status: ticket.status, closedAt: ticket.closedAt };
    }

    const previousStatus = ticket.status;
    const closedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.visaSupportTicket.update({
        where: { id: ticket.id },
        data:  { status: 'CLOSED', closedAt },
      });
      const summary = `Ticket #${this.shortId(ticket.id)} status changed from ${previousStatus} to CLOSED`;
      await tx.visaCaseFileNote.create({
        data: {
          caseId:           visaCase.id,
          noteType:         'SYSTEM_EVENT',
          referenceId:      ticket.id,
          summaryEncrypted: this.crypto.encrypt(summary) as never,
          createdById:      userId,
        },
      });
      await tx.auditLog.createMany({
        data: [
          {
            userId,
            action:     'TICKET_STATUS_CHANGED',
            eventType:  'TICKET_STATUS_CHANGED',
            entityType: 'VisaSupportTicket',
            entityId:   ticket.id,
            oldValue:   { status: previousStatus },
            newValue:   { status: 'CLOSED' },
          },
          {
            userId,
            action:     'TICKET_CLOSED_BY_CLIENT',
            eventType:  'TICKET_CLOSED_BY_CLIENT',
            entityType: 'VisaSupportTicket',
            entityId:   ticket.id,
          },
        ],
      });
      return { id: updated.id, status: updated.status, closedAt: updated.closedAt };
    });
  }

  // Used by the dashboard service for the summary block.
  async getDashboardSummary(userId: string) {
    const visaCase = await this.prisma.visaCase.findFirst({
      where: { clientId: userId },
    });
    if (!visaCase) return { openCount: 0, latestOpen: [] };

    const openCount = await this.prisma.visaSupportTicket.count({
      where: {
        clientId: userId,
        caseId:   visaCase.id,
        status:   { in: ['OPEN', 'IN_PROGRESS'] },
      },
    });
    const latest = await this.prisma.visaSupportTicket.findMany({
      where: {
        clientId: userId,
        caseId:   visaCase.id,
        status:   { in: ['OPEN', 'IN_PROGRESS'] },
      },
      orderBy: [
        { lastStaffMessageAt:  { sort: 'desc', nulls: 'last' } },
        { lastClientMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt:           'desc' },
      ],
      take: 3,
    });
    return {
      openCount,
      latestOpen: latest.map((t) => ({
        id:             t.id,
        subject:        this.dec(t.subjectEncrypted),
        department:     t.department,
        status:         t.status,
        lastActivityAt: t.lastStaffMessageAt ?? t.lastClientMessageAt ?? t.createdAt,
      })),
    };
  }
}
