import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  UserRole,
  VisaTicketDepartment,
  VisaTicketPriority,
  VisaTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

// PR-SUPPORT-1 — Staff-side ticket service.
//
// Sits on top of the existing VisaSupportTicket / VisaSupportTicketMessage
// schema introduced by PR-DASH-2. Mirrors the client-side service's
// encrypt/decrypt + transactional audit + VisaCaseFileNote patterns
// (see backend/src/students/tickets/tickets.service.ts), but with
// staff-role gating instead of the Contact -> Lead -> Case ownership
// chain.
//
// Staff see ALL tickets they have role for — there's no per-row
// ownership check beyond the controller role gate. Tightening to
// "only your assigned tickets" can be added later if needed.
//
// File-note emission policy:
//   * Public staff replies      -> file note (visible on case timeline)
//   * Internal staff notes      -> NO file note (private back-and-forth
//                                  stays inside the ticket thread)
//   * Status changes            -> file note
//   * Assignment changes        -> file note
//   * Audit-log rows always fire regardless.

const STAFF_ASSIGNEE_ROLES: UserRole[] = [
  'OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA',
];

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface TicketListRow {
  id: string;
  subject: string;
  status: VisaTicketStatus;
  department: VisaTicketDepartment;
  priority: VisaTicketPriority;
  clientId: string;
  clientName: string | null;
  caseId: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  lastClientMessageAt: Date | null;
  lastStaffMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketListResult {
  tickets: TicketListRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListFilters {
  status?: string;
  department?: string;
  assigned?: 'me' | 'unassigned' | 'all' | string; // string = a specific staff id
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class StaffTicketsService {
  private readonly logger = new Logger(StaffTicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── Read: list ─────────────────────────────────────────────────────

  async list(filters: ListFilters, actor: Actor): Promise<TicketListResult> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: Prisma.VisaSupportTicketWhereInput = {};

    if (filters.status && filters.status.trim().length > 0) {
      const up = filters.status.trim().toUpperCase();
      if ((Object.values(VisaTicketStatus) as string[]).includes(up)) {
        where.status = up as VisaTicketStatus;
      }
    }
    if (filters.department && filters.department.trim().length > 0) {
      const up = filters.department.trim().toUpperCase();
      if ((Object.values(VisaTicketDepartment) as string[]).includes(up)) {
        where.department = up as VisaTicketDepartment;
      }
    }
    if (filters.assigned) {
      const a = filters.assigned.trim();
      if (a === 'me')              where.assignedStaffId = actor.id;
      else if (a === 'unassigned') where.assignedStaffId = null;
      else if (a !== 'all' && a.length > 0) where.assignedStaffId = a;
    }

    // Search is a substring match on the decrypted subject. Because
    // subjects are encrypted at rest, we can't push the LIKE into the
    // DB — we decrypt the candidate set and filter in-memory. At
    // launch volumes this is fine; if the table grows past ~50k rows
    // a separate search-index or hashing approach will be needed.
    const search = filters.search?.trim().toLowerCase() ?? '';

    const include = {
      client:        { select: { id: true, name: true, email: true } },
      assignedStaff: { select: { id: true, name: true, role: true } },
      _count:        { select: { messages: true } },
    } as const;

    if (search.length === 0) {
      // Fast path — DB-side pagination.
      const [rows, total] = await Promise.all([
        this.prisma.visaSupportTicket.findMany({
          where,
          orderBy: [
            { lastStaffMessageAt:  { sort: 'desc', nulls: 'last' } },
            { lastClientMessageAt: { sort: 'desc', nulls: 'last' } },
            { createdAt:           'desc' },
          ],
          skip: offset,
          take: limit,
          include,
        }),
        this.prisma.visaSupportTicket.count({ where }),
      ]);
      return {
        tickets: rows.map((r) => this.toListRow(r)),
        total,
        limit,
        offset,
      };
    }

    // Search path — fetch the filtered set, decrypt each subject,
    // substring-filter in-memory, then paginate the post-filter list.
    const all = await this.prisma.visaSupportTicket.findMany({
      where,
      orderBy: [
        { lastStaffMessageAt:  { sort: 'desc', nulls: 'last' } },
        { lastClientMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt:           'desc' },
      ],
      include,
    });
    const decoded = all.map((r) => this.toListRow(r));
    const matched = decoded.filter((r) => r.subject.toLowerCase().includes(search));
    return {
      tickets: matched.slice(offset, offset + limit),
      total: matched.length,
      limit,
      offset,
    };
  }

  // ─── Read: detail ───────────────────────────────────────────────────

  async detail(ticketId: string, actor: Actor) {
    const ticket = await this.prisma.visaSupportTicket.findUnique({
      where: { id: ticketId },
      include: {
        client:        { select: { id: true, name: true, email: true } },
        assignedStaff: { select: { id: true, name: true, role: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    // Staff see EVERY message, including isInternalNote=true rows.
    const messages = await this.prisma.visaSupportTicketMessage.findMany({
      where:   { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    // Best-effort audit row. Failure must not block the page.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'READ',
          eventType:  'TICKET_VIEWED_BY_STAFF',
          entityType: 'VisaSupportTicket',
          entityId:   ticket.id,
          newValue:   { ticketId: ticket.id } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    } catch (err: any) {
      this.logger.warn(`[staff-tickets] audit on view of ${ticket.id} failed: ${err?.message ?? err}`);
    }

    return {
      id:                  ticket.id,
      subject:             this.dec(ticket.subjectEncrypted),
      status:              ticket.status,
      department:          ticket.department,
      priority:            ticket.priority,
      clientId:            ticket.clientId,
      clientName:          ticket.client?.name ?? null,
      clientEmail:         ticket.client?.email ?? null,
      caseId:              ticket.caseId,
      assignedStaffId:     ticket.assignedStaffId,
      assignedStaffName:   ticket.assignedStaff?.name ?? null,
      assignedStaffRole:   ticket.assignedStaff?.role ?? null,
      createdAt:           ticket.createdAt,
      updatedAt:           ticket.updatedAt,
      resolvedAt:          ticket.resolvedAt,
      closedAt:            ticket.closedAt,
      lastClientMessageAt: ticket.lastClientMessageAt,
      lastStaffMessageAt:  ticket.lastStaffMessageAt,
      messages: messages.map((m) => ({
        id:             m.id,
        authorId:       m.authorId,
        authorRole:     m.authorRole,
        authorName:     m.author?.name ?? null,
        authorStaffRole: m.author?.role ?? null,
        body:           this.dec(m.bodyEncrypted),
        isInternalNote: m.isInternalNote,
        createdAt:      m.createdAt,
      })),
    };
  }

  // ─── Mutation: staff reply ──────────────────────────────────────────

  async addStaffMessage(
    ticketId: string,
    body: { body: string; isInternalNote?: boolean },
    actor: Actor,
  ) {
    const ticket = await this.prisma.visaSupportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true, caseId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('Cannot reply on a closed ticket.');
    }

    const text = (body.body ?? '').trim();
    if (text.length === 0) {
      throw new BadRequestException('Message body required.');
    }
    const isInternal = body.isInternalNote === true;
    const bodyEncrypted = this.crypto.encrypt(text);

    const created = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.visaSupportTicketMessage.create({
        data: {
          ticketId:       ticket.id,
          authorId:       actor.id,
          authorRole:     'STAFF',
          bodyEncrypted:  bodyEncrypted as never,
          isInternalNote: isInternal,
        },
      });

      // Only public staff replies bump lastStaffMessageAt. An internal
      // note shouldn't make the client think a staff message arrived.
      if (!isInternal) {
        await tx.visaSupportTicket.update({
          where: { id: ticket.id },
          data:  { lastStaffMessageAt: new Date() },
        });
      }

      // Audit row — always fires.
      await tx.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'TICKET_MESSAGE_SENT',
          eventType:  'TICKET_MESSAGE_SENT',
          entityType: 'VisaSupportTicket',
          entityId:   ticket.id,
          newValue: {
            messageId:      msg.id,
            byStaff:        true,
            isInternalNote: isInternal,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      // File note for public replies only. Internal notes stay off
      // the case timeline.
      if (!isInternal) {
        const summary = `Staff replied on ticket #${this.shortId(ticket.id)}`;
        await tx.visaCaseFileNote.create({
          data: {
            caseId:           ticket.caseId,
            noteType:         'SYSTEM_EVENT',
            referenceId:      ticket.id,
            summaryEncrypted: this.crypto.encrypt(summary) as never,
            createdById:      actor.id,
          },
        });
      }

      return msg;
    });

    return {
      id:             created.id,
      createdAt:      created.createdAt,
      isInternalNote: created.isInternalNote,
    };
  }

  // ─── Mutation: status change ────────────────────────────────────────

  async updateStatus(ticketId: string, body: { status: string }, actor: Actor) {
    const target = String(body.status ?? '').toUpperCase();
    if (!(Object.values(VisaTicketStatus) as string[]).includes(target)) {
      throw new BadRequestException(`Invalid status: ${body.status}`);
    }
    const targetStatus = target as VisaTicketStatus;

    const ticket = await this.prisma.visaSupportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true, caseId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status === targetStatus) {
      // Idempotent — no change, no row writes.
      return this.detail(ticketId, actor);
    }

    const previous = ticket.status;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.visaSupportTicket.update({
        where: { id: ticket.id },
        data: {
          status:     targetStatus,
          resolvedAt: targetStatus === 'RESOLVED' ? now : null,
          closedAt:   targetStatus === 'CLOSED'   ? now : null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'TICKET_STATUS_CHANGED',
          eventType:  'TICKET_STATUS_CHANGED',
          entityType: 'VisaSupportTicket',
          entityId:   ticket.id,
          oldValue:   { status: previous } as Prisma.InputJsonValue,
          newValue:   { status: targetStatus, byStaff: true } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const summary = `Ticket #${this.shortId(ticket.id)} status changed from ${previous} to ${targetStatus} by staff`;
      await tx.visaCaseFileNote.create({
        data: {
          caseId:           ticket.caseId,
          noteType:         'SYSTEM_EVENT',
          referenceId:      ticket.id,
          summaryEncrypted: this.crypto.encrypt(summary) as never,
          createdById:      actor.id,
        },
      });
    });

    return this.detail(ticketId, actor);
  }

  // ─── Mutation: assign ──────────────────────────────────────────────

  async assign(
    ticketId: string,
    body: { assignedStaffId: string | null },
    actor: Actor,
  ) {
    const ticket = await this.prisma.visaSupportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, assignedStaffId: true, caseId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const newAssigneeId = body.assignedStaffId ?? null;

    let assigneeName: string | null = null;
    if (newAssigneeId !== null) {
      const target = await this.prisma.user.findUnique({
        where: { id: newAssigneeId },
        select: { id: true, name: true, role: true, isActive: true },
      });
      if (!target) throw new BadRequestException('Assignee not found.');
      if (!target.isActive) throw new BadRequestException('Assignee is not active.');
      if (!STAFF_ASSIGNEE_ROLES.includes(target.role)) {
        throw new ForbiddenException(
          `Assignee role ${target.role} is not allowed on tickets.`,
        );
      }
      assigneeName = target.name;
    }

    if ((ticket.assignedStaffId ?? null) === newAssigneeId) {
      return this.detail(ticketId, actor);
    }

    const previousId = ticket.assignedStaffId;

    await this.prisma.$transaction(async (tx) => {
      await tx.visaSupportTicket.update({
        where: { id: ticket.id },
        data:  { assignedStaffId: newAssigneeId },
      });

      await tx.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'TICKET_ASSIGNED',
          eventType:  'TICKET_ASSIGNED',
          entityType: 'VisaSupportTicket',
          entityId:   ticket.id,
          oldValue:   { assignedStaffId: previousId } as Prisma.InputJsonValue,
          newValue:   { assignedStaffId: newAssigneeId } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const summary = newAssigneeId
        ? `Ticket #${this.shortId(ticket.id)} assigned to ${assigneeName ?? newAssigneeId}`
        : `Ticket #${this.shortId(ticket.id)} unassigned`;
      await tx.visaCaseFileNote.create({
        data: {
          caseId:           ticket.caseId,
          noteType:         'SYSTEM_EVENT',
          referenceId:      ticket.id,
          summaryEncrypted: this.crypto.encrypt(summary) as never,
          createdById:      actor.id,
        },
      });
    });

    return this.detail(ticketId, actor);
  }

  // ─── Read: assignable staff ────────────────────────────────────────

  async listAssignees() {
    const rows = await this.prisma.user.findMany({
      where: {
        role: { in: STAFF_ASSIGNEE_ROLES },
        isActive: true,
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private toListRow(r: {
    id: string;
    subjectEncrypted: Buffer | Uint8Array;
    status: VisaTicketStatus;
    department: VisaTicketDepartment;
    priority: VisaTicketPriority;
    clientId: string;
    caseId: string;
    assignedStaffId: string | null;
    lastClientMessageAt: Date | null;
    lastStaffMessageAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    client: { id: string; name: string; email: string } | null;
    assignedStaff: { id: string; name: string; role: UserRole } | null;
    _count: { messages: number };
  }): TicketListRow {
    return {
      id:                  r.id,
      subject:             this.dec(r.subjectEncrypted),
      status:              r.status,
      department:          r.department,
      priority:            r.priority,
      clientId:            r.clientId,
      clientName:          r.client?.name ?? null,
      caseId:              r.caseId,
      assignedStaffId:     r.assignedStaffId,
      assignedStaffName:   r.assignedStaff?.name ?? null,
      lastClientMessageAt: r.lastClientMessageAt,
      lastStaffMessageAt:  r.lastStaffMessageAt,
      messageCount:        r._count.messages,
      createdAt:           r.createdAt,
      updatedAt:           r.updatedAt,
    };
  }

  private dec(b: Buffer | Uint8Array | null | undefined): string {
    if (!b) return '';
    return this.crypto.decrypt(Buffer.isBuffer(b) ? b : Buffer.from(b));
  }

  private shortId(id: string): string {
    return id.replace(/-/g, '').slice(0, 8);
  }
}
