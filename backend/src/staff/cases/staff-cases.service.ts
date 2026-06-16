import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
  // Option 1 step 1 — list reads the operational `Case` table (FK to
  // Lead) so cases created from the lead-detail "Create Case" action
  // show up. Detail / Activity / Reassign still query VisaCase below;
  // those repoint in later steps.
  async listCases(caller: CallerCtx, query: ListCasesQuery) {
    const page     = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip     = (page - 1) * pageSize;

    // Visibility against the cases table — column-based, not via
    // visa_case_assignments. SUPPORT/FINANCE have no Case-side column
    // and see nothing on this list (the operational Case model only
    // tracks owner + lia).
    const visibilityWhere = this.caseListVisibilityWhere(caller);
    if (visibilityWhere === 'none') {
      return { items: [], total: 0, page, pageSize };
    }

    const where: Record<string, unknown> = { ...visibilityWhere };

    // assignedToMe — narrow to cases where caller personally holds
    // the LIA or owner column. Redundant for LIA/CONSULTANT (already
    // scoped) but meaningfully narrows admin-tier callers.
    if (query.assignedToMe) {
      const prior = Array.isArray(where.AND) ? (where.AND as unknown[]) : [];
      where.AND = [
        ...prior,
        { OR: [{ liaId: caller.userId }, { ownerId: caller.userId }] },
      ];
    }

    // The API field is `status` for frontend compatibility, but matches
    // against the CaseStage enum column. `Case.status` is a vestigial
    // free string ("active" / "APPLICATION_SUBMITTED"); stage is the
    // real state machine (ADMISSION / VISA / INZ_SUBMITTED / …).
    if (query.status) {
      where.stage = query.status;
    }

    // Search — substring match on the lead's contact name or email.
    if (query.q && query.q.trim().length > 0) {
      const term = query.q.trim();
      where.lead = {
        contact: {
          OR: [
            { fullName: { contains: term, mode: 'insensitive' } },
            { email:    { contains: term, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.case.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          lead: {
            include: {
              contact: { select: { fullName: true, email: true, userId: true } },
            },
          },
          owner: { select: { id: true, name: true } },
          lia:   { select: { id: true, name: true } },
        },
      }),
      this.prisma.case.count({ where }),
    ]);

    const items: CaseListRow[] = rows.map((c) => ({
      id:           c.id,
      studentId:    c.lead.contact.userId ?? c.lead.contactId,
      studentName:  c.lead.contact.fullName ?? '',
      studentEmail: c.lead.contact.email ?? '',
      status:       c.stage, // display stage in the status pill — Case.status is vestigial
      stage:        c.stage,
      createdAt:    c.createdAt,
      updatedAt:    c.updatedAt,
      assignedLia:        c.lia   ? { id: c.lia.id,   name: c.lia.name   } : null,
      assignedConsultant: c.owner ? { id: c.owner.id, name: c.owner.name } : null,
    }));

    return { items, total, page, pageSize };
  }

  // List-only visibility (does NOT replace assertVisible used by
  // detail/activity, which still target VisaCase).
  //   - admin tier               → {} (no scoping)
  //   - LIA                      → { liaId:   caller.userId }
  //   - CONSULTANT               → { ownerId: caller.userId }
  //   - SUPPORT / FINANCE / else → 'none' (caller sees zero rows)
  private caseListVisibilityWhere(caller: CallerCtx): Record<string, unknown> | 'none' {
    if (ADMIN_TIER.includes(caller.role)) return {};
    if (caller.role === 'LIA')        return { liaId:   caller.userId };
    if (caller.role === 'CONSULTANT') return { ownerId: caller.userId };
    return 'none';
  }

  // ── Detail ────────────────────────────────────────────────────────
  // Option 1 step 2 — detail reads the operational `Case` table (FK to
  // Lead → Contact). Activity still queries VisaCase via the original
  // assertVisible() helper; step 4 repoints that path.
  async getCaseDetail(caller: CallerCtx, caseId: string) {
    await this.assertVisibleCase(caller, caseId);
    const row = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        lead: {
          include: {
            contact: {
              select: {
                fullName:          true,
                email:             true,
                phone:             true,
                preferredLanguage: true,
                userId:            true,
              },
            },
          },
        },
        owner: { select: { id: true, name: true, role: true } },
        lia:   { select: { id: true, name: true, role: true } },
      },
    });
    if (!row) throw new NotFoundException('Case not found');

    // Split contact.fullName on first whitespace — matches the
    // heuristic the visa-side detail used on User.name.
    const fullName = row.lead.contact.fullName ?? '';
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts.shift() ?? '';
    const lastName  = parts.join(' ');

    return {
      id:        row.id,
      status:    row.stage, // display stage in the status field — Case.status is vestigial
      stage:     row.stage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      student: {
        id:        row.lead.contact.userId ?? row.lead.contactId,
        firstName,
        lastName,
        email:     row.lead.contact.email ?? '',
        locale:    row.lead.contact.preferredLanguage ?? 'en',
        phone:     row.lead.contact.phone ?? null,
      },
      assignments: {
        LIA:        row.lia   ? { id: row.lia.id,   name: row.lia.name,   role: row.lia.role   } : null,
        CONSULTANT: row.owner ? { id: row.owner.id, name: row.owner.name, role: row.owner.role } : null,
        SUPPORT:    null, // Case model has no SUPPORT column — permanently empty.
        FINANCE:    null, // Case model has no FINANCE column — permanently empty.
      },
    };
  }

  // Detail-only visibility against the cases table. Preserves the
  // existing assertVisible() contract:
  //   - case missing OR caller's role has no claim → NotFoundException
  //     (404, not 403, so non-admin callers can't probe which IDs exist)
  //   - role outside the staff allow-list → ForbiddenException
  // The original assertVisible() still targets VisaCase and is used by
  // getCaseActivity() until step 4 repoints it.
  private async assertVisibleCase(caller: CallerCtx, caseId: string) {
    if (ADMIN_TIER.includes(caller.role)) {
      const exists = await this.prisma.case.findUnique({
        where:  { id: caseId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Case not found');
      return;
    }
    if (caller.role === 'LIA') {
      const own = await this.prisma.case.findFirst({
        where:  { id: caseId, liaId: caller.userId },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Case not found');
      return;
    }
    if (caller.role === 'CONSULTANT') {
      const own = await this.prisma.case.findFirst({
        where:  { id: caseId, ownerId: caller.userId },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Case not found');
      return;
    }
    if (caller.role === 'SUPPORT' || caller.role === 'FINANCE') {
      // No Case-side claim possible — surface as 404 to match the
      // non-leak behaviour of the existing assertVisible() rather
      // than distinguishing "exists but not yours" from "doesn't exist".
      throw new NotFoundException('Case not found');
    }
    throw new ForbiddenException('Role cannot access staff cases');
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

  // ── Eligible staff for reassignment ──────────────────────────────
  // Option 1 step 3b — admin-only candidate list for the Reassign
  // overlay. LIA → users with role='LIA' counted via Case.liaId.
  // CONSULTANT → users with role='CONSULTANT' counted via Case.ownerId.
  // Active-case count excludes COMPLETED/WITHDRAWN stages, matching
  // LiaAssignmentService.findActiveLias() in the cases module.
  async listEligibleStaff(slot: 'LIA' | 'CONSULTANT') {
    if (slot !== 'LIA' && slot !== 'CONSULTANT') {
      throw new BadRequestException('slot must be LIA or CONSULTANT');
    }
    if (slot === 'LIA') {
      const users = await this.prisma.user.findMany({
        where: {
          role: 'LIA',
          isActive: true,
          OR: [
            { staffActiveStatus: null },
            { staffActiveStatus: { isActive: true } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          liaCases: {
            where:  { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
            select: { id: true },
          },
        },
      });
      return users.map((u) => ({
        id:              u.id,
        name:            u.name,
        activeCaseCount: u.liaCases.length,
      }));
    }
    const users = await this.prisma.user.findMany({
      where: {
        role: 'CONSULTANT',
        isActive: true,
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        cases: {
          where:  { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
          select: { id: true },
        },
      },
    });
    return users.map((u) => ({
      id:              u.id,
      name:            u.name,
      activeCaseCount: u.cases.length,
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
