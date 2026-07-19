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
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { R2Service } from '../../common/r2/r2.service';
import {
  sanitizeRichText,
  isEffectivelyEmpty,
} from '../../common/html/rich-text-sanitizer';

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

// PR-TICKETS-RICH — attachment constraints (image + common doc types), mirroring
// the staff-photo / case-doc R2 pattern. Re-validated on the actual upload AND on
// the message-store (key prefix + mime + size) so a client can't attach an
// arbitrary R2 object by guessing a key.
const ATTACH_ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
]);
const ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ATTACH_URL_TTL_SECONDS = 3600;       // 1h signed download
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

function attachExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':      return '.jpg';
    case 'image/png':       return '.png';
    case 'image/webp':      return '.webp';
    case 'application/pdf': return '.pdf';
    default:                return '';
  }
}

// Shape stored in VisaSupportTicketMessage.attachments (JSON). The R2 `key` is
// private; reads mint a short-lived signed URL and never expose the key.
export interface StoredAttachment {
  key:  string;
  name: string;
  mime: string;
  size: number;
}

// PR-TICKETS-RICH — the 24h "unanswered" rule: a client message is waiting for a
// staff reply (last message is the client's) AND it has been ≥24h. Closed/resolved
// tickets never alert. Computed from the existing lastClient/lastStaff columns —
// no new column, no cron.
const ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
function unansweredOver24h(
  lastClientMessageAt: Date | null,
  lastStaffMessageAt: Date | null,
  status: VisaTicketStatus,
): boolean {
  if (status === 'CLOSED' || status === 'RESOLVED') return false;
  if (!lastClientMessageAt) return false;
  const answered = lastStaffMessageAt && lastStaffMessageAt >= lastClientMessageAt;
  if (answered) return false;
  return Date.now() - lastClientMessageAt.getTime() >= ALERT_AFTER_MS;
}

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
  unansweredOver24h: boolean;
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
    private readonly r2: R2Service,
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
      // PR-TICKETS-RICH — 24h red alert: a client message is awaiting a staff reply.
      unansweredOver24h:   unansweredOver24h(ticket.lastClientMessageAt, ticket.lastStaffMessageAt, ticket.status),
      messages: await Promise.all(messages.map(async (m) => ({
        id:             m.id,
        authorId:       m.authorId,
        authorRole:     m.authorRole,
        authorName:     m.author?.name ?? null,
        authorStaffRole: m.author?.role ?? null,
        body:           this.dec(m.bodyEncrypted),
        // Render mode: true → sanitized rich-text HTML; false → escaped text.
        bodyIsHtml:     m.bodyIsHtml,
        attachments:    await this.signAttachments(m.attachments),
        isInternalNote: m.isInternalNote,
        createdAt:      m.createdAt,
      }))),
    };
  }

  // ─── Mutation: staff reply ──────────────────────────────────────────

  async addStaffMessage(
    ticketId: string,
    body: { body: string; isInternalNote?: boolean; attachments?: unknown },
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

    // Rich text: sanitize the client HTML server-side against the shared
    // allowlist (bold/italic/underline/lists/links; scripts, on* handlers,
    // javascript: URLs, and <img> are stripped), THEN encrypt the clean HTML
    // into the existing bodyEncrypted column. Client HTML is never trusted.
    const cleanHtml = sanitizeRichText(body.body ?? '');

    // Validate any attachments the composer already uploaded (keys must belong
    // to THIS ticket; mime + size re-checked). This runs before the empty check
    // so an attachment-only message (no text) is allowed.
    const attachments = this.validateAttachments(ticket.id, body.attachments);

    if (isEffectivelyEmpty(cleanHtml) && attachments.length === 0) {
      throw new BadRequestException('A message needs text or an attachment.');
    }
    const isInternal = body.isInternalNote === true;
    const bodyEncrypted = this.crypto.encrypt(cleanHtml);

    const created = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.visaSupportTicketMessage.create({
        data: {
          ticketId:       ticket.id,
          authorId:       actor.id,
          authorRole:     'STAFF',
          bodyIsHtml:     true,
          attachments:    attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
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
      // PR-TICKETS-CYCLE — the target MUST already be on this ticket's VisaCase
      // (server-side enforcement; the UI only offers cycle members, but never
      // trust the client). Re-check against the live cycle on every assign.
      const cycle = await this.caseCycleStaffIds(ticket.caseId);
      if (!cycle.has(newAssigneeId)) {
        throw new ForbiddenException(
          'A ticket can only be assigned to staff already on its case.',
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

  // PR-TICKETS-CYCLE — candidates for reassignment are ONLY the staff already on
  // this ticket's case. The ticket hangs off a VisaCase (NOT the operational
  // Case — the two are deliberately unbridged), so "the case's assignment cycle"
  // is the VisaCase's active VisaCaseAssignment rows (LIA/CONSULTANT/SUPPORT/
  // FINANCE) plus its scalar assignedConsultantId.
  async listAssignees(ticketId: string) {
    const ticket = await this.prisma.visaSupportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, caseId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const cycle = await this.caseCycleStaffIds(ticket.caseId);
    if (cycle.size === 0) return [];

    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...cycle] }, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  // The set of staff currently assigned to a VisaCase: active assignment rows +
  // the scalar assignedConsultantId. This is the single source for "the case's
  // assignment cycle" used by both listAssignees and assign().
  private async caseCycleStaffIds(caseId: string): Promise<Set<string>> {
    const vc = await this.prisma.visaCase.findUnique({
      where:  { id: caseId },
      select: {
        assignedConsultantId: true,
        assignments: { where: { unassignedAt: null }, select: { staffId: true } },
      },
    });
    const ids = new Set<string>();
    if (vc?.assignedConsultantId) ids.add(vc.assignedConsultantId);
    for (const a of vc?.assignments ?? []) ids.add(a.staffId);
    return ids;
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
      // PR-TICKETS-RICH — drives the red "waiting >24h" alert on the list row.
      unansweredOver24h:   unansweredOver24h(r.lastClientMessageAt, r.lastStaffMessageAt, r.status),
      messageCount:        r._count.messages,
      createdAt:           r.createdAt,
      updatedAt:           r.updatedAt,
    };
  }

  // ─── Attachments (R2) ───────────────────────────────────────────────
  // Upload one file for a ticket → returns metadata the composer then attaches to
  // its message POST. Bytes go to R2 under a per-ticket key; only the key is kept.
  async uploadAttachment(
    ticketId: string,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ): Promise<StoredAttachment> {
    const ticket = await this.prisma.visaSupportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('Cannot attach files to a closed ticket.');
    }
    if (!file || !file.buffer) throw new BadRequestException('A file is required.');
    if (!ATTACH_ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException('Unsupported file type. Allowed: JPG, PNG, WebP, or PDF.');
    }
    if (file.size > ATTACH_MAX_BYTES) {
      throw new BadRequestException(`File is too large (max ${ATTACH_MAX_BYTES / (1024 * 1024)} MB).`);
    }

    const key = `ticket-attachments/${ticket.id}/${randomBytes(16).toString('hex')}${attachExt(file.mimetype)}`;
    await this.r2.putObject(key, file.buffer, file.mimetype);

    const meta: StoredAttachment = {
      key,
      name: this.safeName(file.originalname, file.mimetype),
      mime: file.mimetype,
      size: file.size,
    };
    await this.prisma.auditLog.create({
      data: {
        userId:     actor.id,
        action:     'TICKET_ATTACHMENT_UPLOADED',
        eventType:  'TICKET_ATTACHMENT_UPLOADED',
        entityType: 'VisaSupportTicket',
        entityId:   ticket.id,
        newValue:   { key, name: meta.name, mime: meta.mime, size: meta.size } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    }).catch((err) => this.logger.warn(`[staff-tickets] attach audit failed: ${err?.message ?? err}`));

    return meta;
  }

  // Validate attachment metadata sent with a message. Each key MUST belong to
  // this ticket's upload namespace (so a caller can't attach an arbitrary R2
  // object), and mime + size are re-checked. Returns the clean stored shape.
  private validateAttachments(ticketId: string, raw: unknown): StoredAttachment[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('attachments must be an array.');
    if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message.`);
    }
    const prefix = `ticket-attachments/${ticketId}/`;
    return raw.map((a: any) => {
      const key  = String(a?.key ?? '');
      const mime = String(a?.mime ?? '');
      const size = Number(a?.size ?? 0);
      if (!key.startsWith(prefix)) throw new BadRequestException('Attachment does not belong to this ticket.');
      if (!ATTACH_ALLOWED_MIMES.has(mime)) throw new BadRequestException('Unsupported attachment type.');
      if (!(size > 0) || size > ATTACH_MAX_BYTES) throw new BadRequestException('Invalid attachment size.');
      return { key, mime, size, name: this.safeName(String(a?.name ?? 'file'), mime) };
    });
  }

  // Turn stored attachments (with private keys) into client-safe rows carrying a
  // short-lived signed download URL. The R2 key is never returned.
  private async signAttachments(
    raw: unknown,
  ): Promise<Array<{ name: string; mime: string; size: number; url: string | null }>> {
    if (!Array.isArray(raw)) return [];
    return Promise.all(
      (raw as StoredAttachment[]).map(async (a) => {
        let url: string | null = null;
        try {
          url = await this.r2.getPresignedDownloadUrl(a.key, ATTACH_URL_TTL_SECONDS);
        } catch (err: any) {
          this.logger.warn(`[staff-tickets] presign failed for ${a.key}: ${err?.message ?? err}`);
        }
        return { name: a.name, mime: a.mime, size: a.size, url };
      }),
    );
  }

  private safeName(name: string, mime: string): string {
    const base = (name || 'file').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
    return base.length ? base : `file${attachExt(mime)}`;
  }

  private dec(b: Buffer | Uint8Array | null | undefined): string {
    if (!b) return '';
    return this.crypto.decrypt(Buffer.isBuffer(b) ? b : Buffer.from(b));
  }

  private shortId(id: string): string {
    return id.replace(/-/g, '').slice(0, 8);
  }
}
