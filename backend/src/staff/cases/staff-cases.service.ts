import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { summarizeAuditEntry } from '../../common/audit/audit.helper';
import type { StaffRole } from '../roles/staff-roles.decorator';

// PR-CONSULT-2 — Staff cases service.
//
// Three operations:
//   1. listCases — paginated, filterable. Visibility:
//        admin tier (OWNER / SUPER_ADMIN / ADMIN) → all cases.
//        staff (LIA / CONSULTANT / SUPPORT / FINANCE) →
//          only cases where they hold an active VisaCaseAssignment.
//   2. getCaseDetail — same visibility rule; 404 (not 403) when the
//      case isn't visible so a leaky caller can't probe which IDs exist.
//   3. getCaseActivity — last 50 audit rows linked to this case.
//
// No new tables. All reads filter / aggregate from existing rows.

const ADMIN_TIER: StaffRole[] = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];
const NON_ADMIN_TIER: StaffRole[] = ['LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE'];

interface CallerCtx { userId: string; role: StaffRole }

export interface ListCasesQuery {
  status?: string;
  assignedToMe?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface CaseListRow {
  id:                 string;
  studentId:          string;
  studentName:        string;
  studentEmail:       string;
  status:             string;
  stage:              string;
  createdAt:          Date;
  updatedAt:          Date;
  assignedLia:        { id: string; name: string } | null;
  assignedConsultant: { id: string; name: string } | null;
}

@Injectable()
export class StaffCasesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List ──────────────────────────────────────────────────────────
  async listCases(caller: CallerCtx, query: ListCasesQuery) {
    const page     = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip     = (page - 1) * pageSize;

    // Visibility — non-admin staff are scoped to their own assignments.
    const visibleCaseIds = await this.visibleCaseIds(caller);
    if (visibleCaseIds !== 'all' && visibleCaseIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    // assignedToMe — narrow to cases where caller specifically holds
    // an active assignment, even if they're admin-tier.
    let scopedCaseIds: string[] | 'all' = visibleCaseIds;
    if (query.assignedToMe) {
      const mine = await this.casesAssignedTo(caller.userId);
      if (scopedCaseIds === 'all') {
        scopedCaseIds = mine;
      } else {
        scopedCaseIds = scopedCaseIds.filter((id) => mine.includes(id));
      }
      if (scopedCaseIds.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
    }

    // Search — substring match on User.name OR User.email of the
    // case's client. Stored unencrypted on User (the existing User
    // model uses plaintext name + email; encryption is on the
    // VisaApplication identity columns, not on the user record).
    const where: Record<string, unknown> = {};
    if (scopedCaseIds !== 'all') {
      where.id = { in: scopedCaseIds };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.q && query.q.trim().length > 0) {
      const term = query.q.trim();
      where.client = {
        OR: [
          { name:  { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.visaCase.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          client:      { select: { id: true, name: true, email: true } },
          assignments: {
            where:   { unassignedAt: null },
            include: { staff: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.visaCase.count({ where }),
    ]);

    const items: CaseListRow[] = rows.map((c) => {
      const lia = c.assignments.find((a) => a.roleSlot === 'LIA');
      const con = c.assignments.find((a) => a.roleSlot === 'CONSULTANT');
      return {
        id:           c.id,
        studentId:    c.clientId,
        studentName:  c.client?.name ?? '',
        studentEmail: c.client?.email ?? '',
        status:       c.status,
        stage:        c.status, // VisaCase has no separate stage column.
        createdAt:    c.createdAt,
        updatedAt:    c.updatedAt,
        assignedLia:        lia ? { id: lia.staff.id, name: lia.staff.name } : null,
        assignedConsultant: con ? { id: con.staff.id, name: con.staff.name } : null,
      };
    });

    return { items, total, page, pageSize };
  }

  // ── Detail ────────────────────────────────────────────────────────
  async getCaseDetail(caller: CallerCtx, caseId: string) {
    await this.assertVisible(caller, caseId);
    const row = await this.prisma.visaCase.findUnique({
      where: { id: caseId },
      include: {
        client: {
          select: {
            id: true, name: true, email: true,
            contact: {
              select: { preferredLanguage: true, phone: true },
            },
          },
        },
        assignments: {
          where:   { unassignedAt: null },
          include: { staff: { select: { id: true, name: true, role: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Case not found');

    const slot = (s: 'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE') => {
      const r = row.assignments.find((a) => a.roleSlot === s);
      return r ? {
        id:   r.staff.id,
        name: r.staff.name,
        role: r.staff.role,
      } : null;
    };

    // Split `name` into first/last on the first whitespace — matches
    // the heuristic used by the student dashboard.
    const fullName = row.client?.name ?? '';
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts.shift() ?? '';
    const lastName  = parts.join(' ');

    return {
      id:        row.id,
      status:    row.status,
      stage:     row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      student: {
        id:        row.client?.id ?? '',
        firstName,
        lastName,
        email:     row.client?.email ?? '',
        locale:    row.client?.contact?.preferredLanguage ?? 'en',
        phone:     row.client?.contact?.phone ?? null,
      },
      assignments: {
        LIA:        slot('LIA'),
        CONSULTANT: slot('CONSULTANT'),
        SUPPORT:    slot('SUPPORT'),
        FINANCE:    slot('FINANCE'),
      },
    };
  }

  // ── Activity ──────────────────────────────────────────────────────
  async getCaseActivity(caller: CallerCtx, caseId: string) {
    await this.assertVisible(caller, caseId);

    // Audit rows for this case live in two patterns:
    //   1. entityType = 'VisaCase' AND entityId = caseId
    //   2. entityType = 'VisaCaseAssignment' AND newValue.caseId = caseId
    //   3. entityType = 'VisaSupportTicket' / 'VisaMeeting' / etc.
    //      where the row carries `caseId` somewhere in newValue.
    //
    // We can't easily JSON-path query Prisma's `Json?` column in a
    // database-agnostic way without raw SQL, so we widen the candidate
    // set then filter in-memory. 200-row ceiling on the pre-filter keeps
    // the request bounded.
    const candidates = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'VisaCase',           entityId: caseId },
          { entityType: 'VisaCaseAssignment'                  },
          { entityType: 'VisaSupportTicket'                   },
          { entityType: 'VisaSupportTicketMessage'            },
          { entityType: 'VisaMeeting'                         },
          { entityType: 'VisaCaseFileNote'                    },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take:    200,
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    const linksToCase = (blob: unknown): boolean => {
      if (typeof blob !== 'object' || blob === null) return false;
      const c = (blob as Record<string, unknown>).caseId;
      return typeof c === 'string' && c === caseId;
    };

    const filtered = candidates.filter((r) => {
      if (r.entityType === 'VisaCase' && r.entityId === caseId) return true;
      return linksToCase(r.newValue) || linksToCase(r.oldValue);
    }).slice(0, 50);

    return filtered.map((r) => ({
      id:         r.id,
      eventType:  r.eventType ?? r.action,
      actorName:  r.user?.name ?? null,
      actorRole:  r.user?.role ?? null,
      createdAt:  r.createdAt,
      summary:    summarizeAuditEntry({
        eventType:  r.eventType,
        action:     r.action,
        entityType: r.entityType,
        entityId:   r.entityId,
        oldValue:   r.oldValue,
        newValue:   r.newValue,
      }),
    }));
  }

  // ── Visibility helpers ───────────────────────────────────────────
  private async visibleCaseIds(caller: CallerCtx): Promise<'all' | string[]> {
    if (ADMIN_TIER.includes(caller.role)) return 'all';
    if (!NON_ADMIN_TIER.includes(caller.role)) return [];
    return this.casesAssignedTo(caller.userId);
  }

  private async casesAssignedTo(staffId: string): Promise<string[]> {
    const rows = await this.prisma.visaCaseAssignment.findMany({
      where:  { staffId, unassignedAt: null },
      select: { caseId: true },
    });
    return Array.from(new Set(rows.map((r) => r.caseId)));
  }

  // Throws NotFound if the case is invisible to the caller.
  private async assertVisible(caller: CallerCtx, caseId: string) {
    if (ADMIN_TIER.includes(caller.role)) {
      const exists = await this.prisma.visaCase.findUnique({
        where:  { id: caseId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Case not found');
      return;
    }
    if (!NON_ADMIN_TIER.includes(caller.role)) {
      throw new ForbiddenException('Role cannot access staff cases');
    }
    const own = await this.prisma.visaCaseAssignment.findFirst({
      where:  { caseId, staffId: caller.userId, unassignedAt: null },
      select: { id: true },
    });
    if (!own) throw new NotFoundException('Case not found');
  }
}
