import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus, Prisma, ScorecardBand } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-CRM-LEADS — Staff-side leads service.
//
// Read + light-write API for /staff/leads/*. The list query joins
// Contact + ScorecardSubmission + AffiliateAgent + TrackingLink +
// WixPayment[] in a single round trip so the table renders without
// N+1 follow-ups. The status + assign mutations write structured
// audit rows so the activity feed shows who did what.
//
// IMPORTANT: this lives ALONGSIDE the existing `/leads` controller
// (which still serves the older sales-side UI). Both share the same
// underlying Lead model; there's no schema fork.

const ASSIGNEE_ROLES = ['OWNER', 'ADMIN', 'CONSULTANT'] as const;

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface LeadListRow {
  id: string;
  clientId: string | null;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  source: string | null;
  status: LeadStatus;
  createdAt: Date;
  updatedAt: Date;
  scorecardBand: ScorecardBand | null;
  scorecardScore: number | null;
  scorecardSubmittedAt: Date | null;
  assignedToId: string | null;
  assignedToName: string | null;
  attributedAgentName: string | null;
  trackingLinkChannel: string | null;
  hasWixPayments: boolean;
  totalPaidNzd: number;
}

export interface LeadListResult {
  leads: LeadListRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListFilters {
  source?: string;
  status?: string;
  assignedToId?: string;       // "unassigned" sentinel → ownerId IS NULL
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  band?: string;               // "NONE" sentinel → no scorecard
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'name' | 'status' | 'band';
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class StaffLeadsService {
  private readonly logger = new Logger(StaffLeadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── List ──────────────────────────────────────────────────────────

  async list(filters: ListFilters): Promise<LeadListResult> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: Prisma.LeadWhereInput = {};

    if (filters.status && filters.status.trim().length > 0) {
      // Validate against the enum; ignore garbage rather than 400.
      const upper = filters.status.trim().toUpperCase();
      if ((Object.values(LeadStatus) as string[]).includes(upper)) {
        where.leadStatus = upper as LeadStatus;
      }
    }

    if (filters.source && filters.source.trim().length > 0) {
      where.sourceChannel = filters.source.trim();
    }

    if (filters.assignedToId && filters.assignedToId.trim().length > 0) {
      if (filters.assignedToId === 'unassigned') {
        where.ownerId = null;
      } else {
        where.ownerId = filters.assignedToId.trim();
      }
    }

    if (filters.dateFrom) {
      const d = new Date(filters.dateFrom);
      if (!Number.isNaN(d.getTime())) {
        where.createdAt = { ...(where.createdAt as object ?? {}), gte: d };
      }
    }
    if (filters.dateTo) {
      const d = new Date(filters.dateTo);
      if (!Number.isNaN(d.getTime())) {
        // Inclusive end-of-day so "to=2026-05-28" includes that whole day.
        d.setHours(23, 59, 59, 999);
        where.createdAt = { ...(where.createdAt as object ?? {}), lte: d };
      }
    }

    if (filters.band && filters.band.trim().length > 0) {
      const band = filters.band.trim().toUpperCase();
      if (band === 'NONE') {
        where.scorecardSubmission = null;
      } else if ((Object.values(ScorecardBand) as string[]).includes(band)) {
        where.scorecardSubmission = {
          is: { band: band as ScorecardBand, isDraft: false },
        };
      }
    }

    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim();
      where.contact = {
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { email:    { contains: q, mode: 'insensitive' } },
          { phone:    { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    // Sort. Default: createdAt DESC.
    const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: Prisma.LeadOrderByWithRelationInput;
    switch (filters.sortBy) {
      case 'name':   orderBy = { contact: { fullName: sortOrder } }; break;
      case 'status': orderBy = { leadStatus: sortOrder }; break;
      case 'band':   orderBy = { scoreBand: sortOrder }; break;
      default:       orderBy = { createdAt: sortOrder };
    }

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy,
        include: {
          contact:        { select: { fullName: true, email: true, phone: true, countryOfResidence: true } },
          owner:          { select: { id: true, name: true } },
          scorecardSubmission: {
            select: { id: true, band: true, totalScore: true, submittedAt: true, isDraft: true },
          },
          attributedAgent: { select: { fullName: true } },
          trackingLink:   { select: { channel: true } },
          wixPayments:    {
            select: { amount: true, currency: true, status: true },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      leads: rows.map((r) => this.toListRow(r)),
      total,
      limit,
      offset,
    };
  }

  // ─── Detail ────────────────────────────────────────────────────────

  async detail(leadId: string, actor: Actor) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contact:        true,
        owner:          { select: { id: true, name: true, role: true } },
        scorecardSubmission: true,
        attributedAgent: { select: { id: true, fullName: true } },
        trackingLink:   { select: { id: true, shortCode: true, channel: true, campaignLabel: true } },
        wixPayments:    {
          orderBy: { receivedAt: 'desc' },
          select: {
            id: true, paymentType: true, amount: true, currency: true,
            status: true, receivedAt: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { changedBy: { select: { name: true } } },
        },
        // PR-CRM-CASE-CREATE — surface the most recent Case for this
        // lead so the staff detail page can render a View-vs-Create
        // action card without a second round-trip. Schema declares
        // Lead.cases as Case[] (0..N), and CasesService.createCase
        // currently rejects duplicates, so in practice we'll see
        // either 0 or 1 row — but order-by-desc + take:1 stays
        // correct even if the duplicate guard is ever relaxed.
        cases: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Audit the view. Best-effort: a failed audit row must not block the
    // page load.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'READ',
          eventType:  'LEAD_VIEWED_BY_STAFF',
          entityType: 'LEAD',
          entityId:   lead.id,
          newValue:   { leadId: lead.id } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`[staff-leads] audit write failed on view of ${lead.id}: ${(err as Error).message}`);
    }

    const totalPaidNzd = lead.wixPayments
      .filter((p) => p.currency === 'NZD' && p.status === 'RECEIVED')
      .reduce((acc, p) => acc + Number(p.amount), 0);

    return {
      id: lead.id,
      clientId: lead.clientId,
      name: lead.contact.fullName,
      email: lead.contact.email ?? '',
      phone: lead.contact.phone ?? null,
      country: lead.contact.countryOfResidence ?? null,
      // Destination the visitor picked on /start (NEW_ZEALAND | MALAYSIA).
      // Null for legacy/Wix leads and deep-links straight to the assessment.
      targetCountry: lead.targetCountry ?? null,
      source: lead.sourceChannel ?? null,
      status: lead.leadStatus,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,

      // PR-CRM-CASE-CREATE — gate inputs for the Create-Case action
      // card. Sourced from the Lead row's own columns (NOT from
      // scorecardSubmission — that's a snapshot at submission time and
      // doesn't reflect override-panel changes). CasesService.createCase
      // gates on `!lead.executionAllowed || lead.hardStopFlag` so the
      // frontend can pre-check identically and avoid a guaranteed-400
      // POST.
      executionAllowed: lead.executionAllowed,
      hardStopFlag: lead.hardStopFlag,
      hardStopReason: lead.hardStopReason,
      caseId: lead.cases[0]?.id ?? null,

      assignedTo: lead.owner
        ? { id: lead.owner.id, name: lead.owner.name, role: lead.owner.role }
        : null,
      attributedAgent: lead.attributedAgent
        ? { id: lead.attributedAgent.id, fullName: lead.attributedAgent.fullName }
        : null,
      trackingLink: lead.trackingLink
        ? {
            id: lead.trackingLink.id,
            shortCode: lead.trackingLink.shortCode,
            channel: lead.trackingLink.channel,
            campaignLabel: lead.trackingLink.campaignLabel,
          }
        : null,

      scorecard: lead.scorecardSubmission && !lead.scorecardSubmission.isDraft
        ? {
            submissionId:        lead.scorecardSubmission.id,
            band:                lead.scorecardSubmission.band,
            totalScore:          lead.scorecardSubmission.totalScore,
            submittedAt:         lead.scorecardSubmission.submittedAt,
            executionEligible:   lead.scorecardSubmission.executionEligible,
            hardStopsCount: Array.isArray(lead.scorecardSubmission.hardStops)
              ? lead.scorecardSubmission.hardStops.length
              : 0,
          }
        : null,

      wixPayments: lead.wixPayments.map((p) => ({
        id: p.id,
        paymentType: p.paymentType,
        amount: p.amount.toString(),
        currency: p.currency,
        status: p.status,
        receivedAt: p.receivedAt,
      })),
      totalPaidNzd,

      statusHistory: lead.statusHistory.map((h) => ({
        status: h.toStatus,
        changedAt: h.createdAt,
        changedByName: h.changedBy?.name ?? null,
      })),
    };
  }

  // ─── Status update ─────────────────────────────────────────────────

  async updateStatus(
    leadId: string,
    body: { status: string; note?: string },
    actor: Actor,
  ) {
    const target = String(body.status ?? '').toUpperCase();
    if (!(Object.values(LeadStatus) as string[]).includes(target)) {
      throw new BadRequestException(`Invalid status: ${body.status}`);
    }
    const targetStatus = target as LeadStatus;

    const existing = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, leadStatus: true },
    });
    if (!existing) throw new NotFoundException('Lead not found');

    if (existing.leadStatus === targetStatus) {
      // No-op: same status. Skip the write + audit.
      return this.detail(leadId, actor);
    }

    const note = body.note?.trim() ? body.note.trim().slice(0, 1000) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: { leadStatus: targetStatus },
      });

      await tx.leadStatusHistory.create({
        data: {
          leadId,
          fromStatus: existing.leadStatus,
          toStatus: targetStatus,
          changedById: actor.id,
          reason: note,
          isOverride: false,
          isUndo: false,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'LEAD_STATUS_CHANGED',
          entityType: 'LEAD',
          entityId: leadId,
          oldValue: { status: existing.leadStatus } as Prisma.InputJsonValue,
          newValue: { status: targetStatus, note } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      // The Lead enum doesn't have a literal "CONVERTED" value; we treat
      // CLOSED_WON as the conversion event for the audit feed.
      if (targetStatus === 'CLOSED_WON') {
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: 'UPDATE',
            eventType: 'LEAD_CONVERTED',
            entityType: 'LEAD',
            entityId: leadId,
            newValue: { status: targetStatus, note } as Prisma.InputJsonValue,
            actorNameSnapshot: actor.name ?? null,
            actorRoleSnapshot: actor.role ?? null,
          },
        });
      }
    });

    return this.detail(leadId, actor);
  }

  // ─── Assign ────────────────────────────────────────────────────────

  async assign(
    leadId: string,
    body: { assignedToId: string | null },
    actor: Actor,
  ) {
    const existing = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, ownerId: true },
    });
    if (!existing) throw new NotFoundException('Lead not found');

    const newOwnerId = body.assignedToId ?? null;

    if (newOwnerId) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: newOwnerId },
        select: { id: true, role: true, isActive: true },
      });
      if (!assignee) throw new BadRequestException('Assignee not found');
      if (!assignee.isActive) throw new BadRequestException('Assignee is not active');
      if (!(ASSIGNEE_ROLES as readonly string[]).includes(assignee.role)) {
        throw new ForbiddenException('Assignee must be an OWNER, ADMIN, or CONSULTANT');
      }
    }

    if ((existing.ownerId ?? null) === newOwnerId) {
      return this.detail(leadId, actor);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: { ownerId: newOwnerId, assignedAt: newOwnerId ? new Date() : null },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'LEAD_ASSIGNED',
          entityType: 'LEAD',
          entityId: leadId,
          oldValue: { assignedToId: existing.ownerId } as Prisma.InputJsonValue,
          newValue: { assignedToId: newOwnerId } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return this.detail(leadId, actor);
  }

  // ─── Assignee picker support ───────────────────────────────────────

  async listAssignees() {
    const rows = await this.prisma.user.findMany({
      where: {
        role: { in: ASSIGNEE_ROLES as unknown as string[] as any },
        isActive: true,
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  // ─── Internal: list-row hydration ──────────────────────────────────

  private toListRow(r: {
    id: string;
    clientId: string | null;
    leadStatus: LeadStatus;
    sourceChannel: string | null;
    createdAt: Date;
    updatedAt: Date;
    ownerId: string | null;
    contact: {
      fullName: string;
      email: string | null;
      phone: string | null;
      countryOfResidence: string | null;
    };
    owner: { id: string; name: string } | null;
    scorecardSubmission: {
      band: ScorecardBand;
      totalScore: number;
      submittedAt: Date;
      isDraft: boolean;
    } | null;
    attributedAgent: { fullName: string } | null;
    trackingLink: { channel: string } | null;
    wixPayments: { amount: Prisma.Decimal; currency: string; status: string }[];
  }): LeadListRow {
    const submitted = r.scorecardSubmission && !r.scorecardSubmission.isDraft
      ? r.scorecardSubmission
      : null;

    const paid = r.wixPayments
      .filter((p) => p.currency === 'NZD' && p.status === 'RECEIVED')
      .reduce((acc, p) => acc + Number(p.amount), 0);

    return {
      id: r.id,
      clientId: r.clientId,
      name: r.contact.fullName,
      email: r.contact.email ?? '',
      phone: r.contact.phone,
      country: r.contact.countryOfResidence,
      source: r.sourceChannel,
      status: r.leadStatus,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      scorecardBand:        submitted?.band ?? null,
      scorecardScore:       submitted?.totalScore ?? null,
      scorecardSubmittedAt: submitted?.submittedAt ?? null,
      assignedToId: r.ownerId,
      assignedToName: r.owner?.name ?? null,
      attributedAgentName: r.attributedAgent?.fullName ?? null,
      trackingLinkChannel: r.trackingLink?.channel ?? null,
      hasWixPayments: r.wixPayments.length > 0,
      totalPaidNzd: paid,
    };
  }
}
