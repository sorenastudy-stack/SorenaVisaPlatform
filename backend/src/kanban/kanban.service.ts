import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VisaTicketDepartment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-CO-KANBAN — Client Officer daily task kanban. A single board over the CO's
// clients across the FULL journey: pre-contract leads (nurturing → ready to refer)
// then their cases (Admission → Visa → INZ → Completed). It is mostly a VISIBILITY
// board: only the two PRE-CONTRACT lead columns are editable (via the manual
// ADVANCE/POSTPONE override in NurtureService); everything from Admission on is
// read-only to the CO (handed off to Admission Office / LIA). Scoped to the caller's
// own clients; admin tier sees all.

export type StaffActor = { userId: string; role: string };
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export interface KanbanCard {
  kind: 'LEAD' | 'CASE';
  id: string;
  contactId: string | null;
  clientName: string | null;
  officerName: string | null;
  href: string;                 // open the client's lead/case file
  editable: boolean;
  // Lead-only:
  nurtureStage?: string;
  nurtureHeldUntil?: Date | null;
  nurtureHoldReason?: string | null;
  // Case-only:
  stage?: string;
}
export interface KanbanColumn { key: string; label: string; editable: boolean; cards: KanbanCard[] }

const CASE_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'ADMISSION', label: 'Admission' },
  { key: 'VISA', label: 'Visa' },
  { key: 'INZ_SUBMITTED', label: 'INZ submitted' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'WITHDRAWN', label: 'Withdrawn' },
];

@Injectable()
export class KanbanService {
  constructor(private readonly prisma: PrismaService) {}

  async getKanban(actor: StaffActor): Promise<{ columns: KanbanColumn[] }> {
    const isAdmin = ADMIN_TIER.has(actor.role);

    // ── Pre-contract leads (mine): a completed FREE_15 by this CO, no case, no
    //    contract. Grouped into Nurturing (active) vs Ready-to-refer (else).
    const leads = await this.prisma.lead.findMany({
      where: {
        cases: { none: {} },
        contracts: { none: {} },
        consultations: {
          some: { type: 'FREE_15', status: 'COMPLETED', ...(isAdmin ? {} : { assignedToId: actor.userId }) },
        },
      },
      select: {
        id: true, nurtureStage: true, nurtureHeldUntil: true, nurtureHoldReason: true,
        contact: { select: { id: true, fullName: true } },
        consultations: {
          where: { type: 'FREE_15', status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' }, take: 1,
          select: { assignedTo: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const nurturing: KanbanCard[] = [];
    const readyToRefer: KanbanCard[] = [];
    for (const l of leads) {
      const card: KanbanCard = {
        kind: 'LEAD', id: l.id, contactId: l.contact?.id ?? null,
        clientName: l.contact?.fullName ?? null,
        officerName: l.consultations[0]?.assignedTo?.name ?? null,
        href: `/staff/leads/${l.id}`, editable: true,
        nurtureStage: String(l.nurtureStage),
        nurtureHeldUntil: l.nurtureHeldUntil, nurtureHoldReason: l.nurtureHoldReason,
      };
      if (l.nurtureStage === 'SEQUENCE' || l.nurtureStage === 'NEWSLETTER') nurturing.push(card);
      else readyToRefer.push(card);
    }

    // ── Cases (mine): grouped by stage. Read-only to the CO.
    const cases = await this.prisma.case.findMany({
      where: { ...(isAdmin ? {} : { consultantId: actor.userId }) },
      select: {
        id: true, stage: true,
        consultant: { select: { name: true } },
        lead: { select: { contact: { select: { id: true, fullName: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const byStage = new Map<string, KanbanCard[]>();
    for (const c of cases) {
      const card: KanbanCard = {
        kind: 'CASE', id: c.id, contactId: c.lead?.contact?.id ?? null,
        clientName: c.lead?.contact?.fullName ?? null,
        officerName: c.consultant?.name ?? null,
        href: `/staff/cases/${c.id}`, editable: false, stage: String(c.stage),
      };
      const arr = byStage.get(String(c.stage)) ?? [];
      arr.push(card);
      byStage.set(String(c.stage), arr);
    }

    const columns: KanbanColumn[] = [
      { key: 'NURTURING', label: 'Nurturing', editable: true, cards: nurturing },
      { key: 'READY_TO_REFER', label: 'Ready to refer', editable: true, cards: readyToRefer },
      ...CASE_COLUMNS.map((c) => ({ key: c.key, label: c.label, editable: false, cards: byStage.get(c.key) ?? [] })),
    ];
    return { columns };
  }

  // POST /staff/tickets — a staff/CO-raised, department-routed ticket about a
  // client. Uses the CRM-keyed generic Ticket (contactId + optional CRM caseId) —
  // NOT VisaSupportTicket, which is hard-locked to a VisaCase + student account and
  // so can't serve a pre-contract lead card. The VisaTicketDepartment enum is reused
  // for routing, so departments match the visa-support queue.
  async createStaffTicket(
    actor: StaffActor & { name?: string | null },
    body: { contactId: string; caseId?: string | null; department: VisaTicketDepartment; subject: string },
  ): Promise<{ id: string }> {
    if (!body.subject?.trim()) throw new BadRequestException('A subject is required.');
    const contact = await this.prisma.contact.findUnique({ where: { id: body.contactId }, select: { id: true } });
    if (!contact) throw new NotFoundException('Client not found');

    const ticket = await this.prisma.ticket.create({
      data: {
        contactId: body.contactId,
        caseId: body.caseId ?? null,
        subject: body.subject.trim(),
        department: body.department,
        status: 'OPEN',
        priority: 'NORMAL',
        createdById: actor.userId,
      },
      select: { id: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor.userId ?? null, action: 'CREATE', eventType: 'TICKET_RAISED_BY_STAFF',
        entityType: 'Ticket', entityId: ticket.id,
        newValue: { department: body.department, caseId: body.caseId ?? null } as any,
        actorNameSnapshot: actor.name ?? null, actorRoleSnapshot: actor.role ?? null,
      },
    });
    return ticket;
  }
}
