import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffPhotoService } from '../photos/staff-photo.service';
import { summarizeAuditEntry } from '../../common/audit/audit.helper';
import type { StaffAccessRole } from '../roles/staff-roles.decorator';

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

const ADMIN_TIER: StaffAccessRole[] = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];
const NON_ADMIN_TIER: StaffAccessRole[] = ['LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE'];
// PR-OPS-CASES: roles that may READ every case (no per-assignment scoping).
// OPERATIONS is read-all like admin tier, but WITHOUT admin powers
// (no reassignment / risk / legal — those routes exclude it).
const SEE_ALL_TIER: StaffAccessRole[] = [...ADMIN_TIER, 'OPERATIONS'];

interface CallerCtx { userId: string; role: StaffAccessRole }

export interface ListCasesQuery {
  status?: string;
  assignedToMe?: boolean;
  activeOnly?: boolean;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: StaffPhotoService,
  ) {}

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
    } else if (query.activeOnly) {
      // PR-OPS-CASES: active = still in-flight (not completed/withdrawn).
      // Only applied when no explicit stage filter is set.
      where.stage = { notIn: ['COMPLETED', 'WITHDRAWN'] };
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

  // List-only visibility. Each non-admin role is scoped to the cases where
  // they hold THEIR slot column (the auto-assignment slots):
  //   - admin tier + OPERATIONS  → {} (no scoping)
  //   - LIA                      → { liaId:        caller.userId }
  //   - CONSULTANT (Admission)   → { ownerId:      caller.userId }
  //   - SUPPORT (Pastoral Care)  → { supportId:    caller.userId }   (Phase 5b)
  //   - FINANCE                  → { financeId:    caller.userId }   (Phase 5b)
  //   - CLIENT_CONSULTANT        → { consultantId: caller.userId }   (Phase 5b)
  //   - anything else            → 'none' (caller sees zero rows)
  private caseListVisibilityWhere(caller: CallerCtx): Record<string, unknown> | 'none' {
    // Admin tier + OPERATIONS see every case (no scoping).
    if (SEE_ALL_TIER.includes(caller.role)) return {};
    if (caller.role === 'LIA')               return { liaId:        caller.userId };
    if (caller.role === 'CONSULTANT')        return { ownerId:      caller.userId };
    if (caller.role === 'SUPPORT')           return { supportId:    caller.userId };
    if (caller.role === 'FINANCE')           return { financeId:    caller.userId };
    if (caller.role === 'CLIENT_CONSULTANT') return { consultantId: caller.userId };
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
        owner:      { select: { id: true, name: true, role: true, photoKey: true } },
        lia:        { select: { id: true, name: true, role: true, photoKey: true } },
        support:    { select: { id: true, name: true, role: true, photoKey: true } },
        finance:    { select: { id: true, name: true, role: true, photoKey: true } },
        // PR-CLIENT-CONSULTANT-SLOT: the CLIENT_CONSULTANT slot (Case.consultantId),
        // surfaced so the Assignments panel can show + reassign it like the others.
        consultant: { select: { id: true, name: true, role: true, photoKey: true } },
      },
    });
    if (!row) throw new NotFoundException('Case not found');

    // Presigned photo URLs for each assignee (null when unset / not staff).
    const [liaPhoto, ownerPhoto, supportPhoto, financePhoto, consultantPhoto] = await Promise.all([
      this.photos.presignedUrl(row.lia?.photoKey),
      this.photos.presignedUrl(row.owner?.photoKey),
      this.photos.presignedUrl(row.support?.photoKey),
      this.photos.presignedUrl(row.finance?.photoKey),
      this.photos.presignedUrl(row.consultant?.photoKey),
    ]);

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
      notes:     row.notes ?? null, // PR-OPS-CASES: editable on the overview tab
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
        LIA:               row.lia        ? { id: row.lia.id,        name: row.lia.name,        role: row.lia.role,        photoUrl: liaPhoto        } : null,
        CONSULTANT:        row.owner      ? { id: row.owner.id,      name: row.owner.name,      role: row.owner.role,      photoUrl: ownerPhoto      } : null,
        SUPPORT:           row.support    ? { id: row.support.id,    name: row.support.name,    role: row.support.role,    photoUrl: supportPhoto    } : null,
        FINANCE:           row.finance    ? { id: row.finance.id,    name: row.finance.name,    role: row.finance.role,    photoUrl: financePhoto    } : null,
        // PR-CLIENT-CONSULTANT-SLOT — the CLIENT_CONSULTANT (Case.consultantId) slot.
        CLIENT_CONSULTANT: row.consultant ? { id: row.consultant.id, name: row.consultant.name, role: row.consultant.role, photoUrl: consultantPhoto } : null,
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
    if (SEE_ALL_TIER.includes(caller.role)) {
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
    // Phase 5b — SUPPORT / FINANCE / CLIENT_CONSULTANT are now scoped to their
    // own Case slot column (matching the list). 404 (not 403) when the case
    // isn't theirs, mirroring the LIA/CONSULTANT non-leak behaviour above.
    if (caller.role === 'SUPPORT') {
      const own = await this.prisma.case.findFirst({
        where:  { id: caseId, supportId: caller.userId },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Case not found');
      return;
    }
    if (caller.role === 'FINANCE') {
      const own = await this.prisma.case.findFirst({
        where:  { id: caseId, financeId: caller.userId },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Case not found');
      return;
    }
    if (caller.role === 'CLIENT_CONSULTANT') {
      const own = await this.prisma.case.findFirst({
        where:  { id: caseId, consultantId: caller.userId },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Case not found');
      return;
    }
    throw new ForbiddenException('Role cannot access staff cases');
  }

  // ── Activity ──────────────────────────────────────────────────────
  async getCaseActivity(caller: CallerCtx, caseId: string) {
    // Phase 5b — gate on the Case slot columns (assertVisibleCase), matching
    // list + detail, instead of the legacy assertVisible() which scoped via the
    // visaCaseAssignment table. This makes list/detail/activity agree on one
    // source and also fixes the pre-existing case where a LIA/CONSULTANT could
    // see + open a case (via Case.liaId/ownerId) yet 404 on its activity for
    // lack of a visaCaseAssignment row. The same :id is a Case.id in both.
    await this.assertVisibleCase(caller, caseId);

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

  // ── OPS dashboard ──────────────────────────────────────────────────
  // PR-OPS-DASHBOARD — SEE_ALL (admin tier + OPERATIONS). Reuses:
  //   • counts   → case.groupBy by stage (dashboard.service pattern) + active filter
  //   • worklist → existing signals (hard-stop / high-risk / unassigned / escalation)
  //   • recent   → cross-case slice of the audit log, formatted with the same
  //                summarizeAuditEntry the per-case /:id/activity feed uses.
  // No new tracking fields. "stuck in stage" / "missing docs" are intentionally
  // NOT included (no clean source — see PR notes).
  async opsDashboard(caller: CallerCtx) {
    if (!SEE_ALL_TIER.includes(caller.role)) {
      throw new ForbiddenException('Role cannot access the operations dashboard');
    }
    const ACTIVE_STAGES: Prisma.EnumCaseStageFilter = { notIn: ['COMPLETED', 'WITHDRAWN'] };

    // 1) Counts by active stage.
    const grouped = await this.prisma.case.groupBy({
      by: ['stage'],
      where: { stage: ACTIVE_STAGES },
      _count: { _all: true },
    });
    const countMap = new Map(grouped.map((g) => [String(g.stage), g._count._all]));
    const countsByStage = ['ADMISSION', 'VISA', 'INZ_SUBMITTED'].map((stage) => ({
      stage,
      count: countMap.get(stage) ?? 0,
    }));

    // 2) Worklist — active cases matching any needs-action signal.
    const flagged = await this.prisma.case.findMany({
      where: {
        stage: ACTIVE_STAGES,
        OR: [
          { liaId: null },
          { riskLevel: { in: ['HIGH', 'BLOCKED'] } },
          { lead: { hardStopFlag: true } },
          { lead: { liaEscalationRequired: true } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true, stage: true, liaId: true, riskLevel: true, updatedAt: true,
        lead: {
          select: {
            hardStopFlag: true, liaEscalationRequired: true,
            contact: { select: { fullName: true, email: true } },
          },
        },
      },
    });
    const REASON_WEIGHT: Record<string, number> = { HARD_STOP: 4, HIGH_RISK: 3, ESCALATION: 2, UNASSIGNED: 1 };
    const worklist = flagged
      .map((c) => {
        const reasons: string[] = [];
        if (c.lead?.hardStopFlag) reasons.push('HARD_STOP');
        if (c.riskLevel === 'HIGH' || c.riskLevel === 'BLOCKED') reasons.push('HIGH_RISK');
        if (c.lead?.liaEscalationRequired) reasons.push('ESCALATION');
        if (!c.liaId) reasons.push('UNASSIGNED');
        const weight = reasons.reduce((m, r) => Math.max(m, REASON_WEIGHT[r] ?? 0), 0);
        return {
          caseId: c.id,
          clientName: c.lead?.contact?.fullName || c.lead?.contact?.email || 'Client',
          stage: c.stage,
          reasons,
          weight,
          updatedAt: c.updatedAt,
        };
      })
      .sort((a, b) => b.weight - a.weight || b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(({ weight, ...rest }) => rest);

    // 3) Recent activity — cross-case audit slice. Only rows resolving to a
    //    real Case are surfaced, so every row links cleanly to /ops/cases/:id.
    const candidates = await this.prisma.auditLog.findMany({
      where: {
        entityType: { in: ['CASE', 'VisaCase', 'VisaCaseAssignment', 'VisaCaseFileNote', 'VisaSupportTicket', 'VisaMeeting'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { name: true, role: true } } },
    });
    const deriveCaseId = (r: (typeof candidates)[number]): string | null => {
      if ((r.entityType === 'CASE' || r.entityType === 'VisaCase') && r.entityId) return r.entityId;
      for (const blob of [r.newValue, r.oldValue]) {
        if (blob && typeof blob === 'object' && typeof (blob as Record<string, unknown>).caseId === 'string') {
          return (blob as Record<string, string>).caseId;
        }
      }
      return null;
    };
    const withCase = candidates
      .map((r) => ({ r, caseId: deriveCaseId(r) }))
      .filter((x): x is { r: (typeof candidates)[number]; caseId: string } => !!x.caseId);
    const ids = Array.from(new Set(withCase.map((x) => x.caseId)));
    const cases = ids.length
      ? await this.prisma.case.findMany({
          where: { id: { in: ids } },
          select: { id: true, lead: { select: { contact: { select: { fullName: true, email: true } } } } },
        })
      : [];
    const nameById = new Map(cases.map((c) => [c.id, c.lead?.contact?.fullName || c.lead?.contact?.email || 'Client']));
    const recentActivity = withCase
      .filter((x) => nameById.has(x.caseId))
      .slice(0, 12)
      .map(({ r, caseId }) => ({
        id: r.id,
        caseId,
        clientName: nameById.get(caseId) ?? 'Client',
        actorName: r.user?.name ?? null,
        actorRole: r.user?.role ?? null,
        createdAt: r.createdAt,
        summary: summarizeAuditEntry({
          eventType: r.eventType, action: r.action, entityType: r.entityType,
          entityId: r.entityId, oldValue: r.oldValue, newValue: r.newValue,
        }),
      }));

    return { countsByStage, worklist, recentActivity };
  }

  // ── Eligible staff for reassignment ──────────────────────────────
  // Option 1 step 3b — admin-only candidate list for the Reassign
  // overlay. LIA → users with role='LIA' counted via Case.liaId.
  // CONSULTANT → users with role='CONSULTANT' counted via Case.ownerId.
  // Active-case count excludes COMPLETED/WITHDRAWN stages, matching
  // LiaAssignmentService.findActiveLias() in the cases module.
  async listEligibleStaff(slot: 'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE' | 'CLIENT_CONSULTANT') {
    if (slot !== 'LIA' && slot !== 'CONSULTANT' && slot !== 'SUPPORT' && slot !== 'FINANCE' && slot !== 'CLIENT_CONSULTANT') {
      throw new BadRequestException('slot must be LIA, CONSULTANT, CLIENT_CONSULTANT, SUPPORT, or FINANCE');
    }
    if (slot === 'CLIENT_CONSULTANT') {
      // PR-CLIENT-CONSULTANT-SLOT — candidates for Case.consultantId. Mirrors the
      // CONSULTANT branch but keys off role CLIENT_CONSULTANT and counts open
      // cases via the consultantCases relation (Case.consultantId).
      const users = await this.prisma.user.findMany({
        where: {
          role: 'CLIENT_CONSULTANT',
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
          consultantCases: {
            where:  { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
            select: { id: true },
          },
        },
      });
      return users.map((u) => ({
        id:              u.id,
        name:            u.name,
        activeCaseCount: u.consultantCases.length,
      }));
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
    if (slot === 'CONSULTANT') {
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
    if (slot === 'SUPPORT') {
      const users = await this.prisma.user.findMany({
        where: {
          role: 'SUPPORT',
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
          supportCases: {
            where:  { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
            select: { id: true },
          },
        },
      });
      return users.map((u) => ({
        id:              u.id,
        name:            u.name,
        activeCaseCount: u.supportCases.length,
      }));
    }
    const users = await this.prisma.user.findMany({
      where: {
        role: 'FINANCE',
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
        financeCases: {
          where:  { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
          select: { id: true },
        },
      },
    });
    return users.map((u) => ({
      id:              u.id,
      name:            u.name,
      activeCaseCount: u.financeCases.length,
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
    if (SEE_ALL_TIER.includes(caller.role)) {
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
