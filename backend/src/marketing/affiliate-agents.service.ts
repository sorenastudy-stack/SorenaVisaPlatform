import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { AffiliateAgentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_COMMISSION_RATE_PERCENT } from '../commissions/agent-payables.service';
import {
  CreateAffiliateAgentDto, UpdateAffiliateAgentDto,
} from './dto/marketing.dto';

// PR-SCORECARD-2 — AffiliateAgent service.
//
// CRUD over named affiliate partners. Commission percentages and
// payout workflow are explicitly DEFERRED to PR-AFFILIATE-1 — this
// service captures identity and lifecycle only.
//
// Delete safety: an agent with ACTIVE tracking links can't be deleted.
// They must be archived first. An agent with only ARCHIVED links can
// be deleted (links cascade via tracking_links.agentId SET NULL — the
// links survive but become orphans, which matches the spec ("existing
// leads stay attributed").

interface Actor {
  userId: string;
  name: string | null;
  role: string;
}

export interface AgentListItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: AffiliateAgentStatus;
  notes: string | null;
  activeLinkCount: number;
  totalLeadCount: number;
  createdAt: string;
  updatedAt: string;
  // PR-AGENT-PORTAL-2 — the three things an Owner previously had to open each
  // agent to discover, and in the rate's case could not discover at all.
  /** Null = no per-agent rate; the company default applies. NOT the same as 0. */
  commissionRatePercent: number | null;
  /** The rate actually used when a payable is derived, default included. */
  effectiveRatePercent: number;
  usesCompanyDefault: boolean;
  verified: boolean;
  /**
   * 'SIGNED' is unreachable today — nothing can set contractSignedAt except the
   * Owner override, which also sets contractIsManualOverride. It is derived
   * honestly anyway rather than collapsed into MANUAL_OVERRIDE, because phase 3
   * writes exactly that state and a UI that had been told overrides and
   * signatures look identical would then be wrong about real contracts.
   */
  contractState: 'NONE' | 'MANUAL_OVERRIDE' | 'SIGNED';
}

/** PR-AGENT-PORTAL phase 1 — whether this agent can actually use the portal,
 *  and why not. Mirrors resolveAgentAccess so the Owner sees the same verdict
 *  the agent does rather than a second opinion assembled here. */
export interface AgentPortalAccess {
  hasLogin: boolean;
  verified: boolean;
  contracted: boolean;
  /** TRUE when a human cleared the contract rather than the agent signing. */
  contractIsManualOverride: boolean;
  contractClearedByName: string | null;
  contractClearedReason: string | null;
  allowed: boolean;
}

export interface AgentDetail extends AgentListItem {
  portalAccess: AgentPortalAccess;
  links: Array<{
    id: string;
    shortCode: string;
    channel: string;
    status: string;
    campaignLabel: string | null;
    clickCount: number;
    createdAt: string;
  }>;
  bandDistribution: Record<string, number>;
}

export interface AgentHistoryEntry {
  id: string;
  eventType: string;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  /** Plain-English line for the Owner. Derived, never stored. */
  summary: string;
}

// One readable sentence per audit row. Kept out of the UI so the wording is the
// same wherever the history is shown, and so a screen never has to understand
// the shape of a JSON payload it did not write.
function summariseAgentEvent(eventType: string | null, oldValue: unknown, newValue: unknown): string {
  const n = (newValue ?? {}) as Record<string, unknown>;
  const o = (oldValue ?? {}) as Record<string, unknown>;
  const pct = (v: unknown) => (v === null || v === undefined ? 'the company default' : `${v}%`);

  switch (eventType) {
    case 'AFFILIATE_AGENT_CREATED':
      return 'Agent created.';
    case 'AFFILIATE_AGENT_UPDATED': {
      const fields = Array.isArray(n.changedFields) ? (n.changedFields as string[]) : [];
      return fields.length ? `Details updated: ${fields.join(', ')}.` : 'Details updated.';
    }
    case 'AFFILIATE_AGENT_STATUS_CHANGED':
      return `Status changed to ${String(n.status ?? n.to ?? 'unknown')}.`;
    case 'AFFILIATE_AGENT_RATE_CHANGED':
      return `Commission rate changed from ${pct(o.ratePercent ?? n.previousRatePercent)} to ${pct(n.ratePercent)}.`;
    case 'AGENT_CONTRACT_MANUALLY_CLEARED':
      return `Contract manually cleared${n.reason ? ` — “${String(n.reason)}”` : ''}.`;
    case 'AFFILIATE_AGENT_DELETED':
      return 'Agent deleted.';
    default:
      return eventType ? eventType.replace(/_/g, ' ').toLowerCase() : 'Change recorded.';
  }
}

@Injectable()
export class AffiliateAgentsService {
  private readonly logger = new Logger(AffiliateAgentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(opts: {
    status?: AffiliateAgentStatus;
    search?: string;
  }): Promise<AgentListItem[]> {
    const where: Prisma.AffiliateAgentWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.search && opts.search.trim()) {
      where.OR = [
        { fullName: { contains: opts.search.trim(), mode: 'insensitive' } },
        { email: { contains: opts.search.trim(), mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.affiliateAgent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { attributedLeads: true, trackingLinks: true } },
        trackingLinks: { select: { status: true } },
      },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      status: r.status,
      notes: r.notes,
      activeLinkCount: r.trackingLinks.filter((l) => l.status === 'ACTIVE').length,
      totalLeadCount: r._count.attributedLeads,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      commissionRatePercent: r.commissionRatePercent,
      effectiveRatePercent: r.commissionRatePercent ?? AGENT_COMMISSION_RATE_PERCENT,
      usesCompanyDefault: r.commissionRatePercent === null,
      verified: !!r.verifiedAt,
      contractState: (!r.contractSignedAt
        ? 'NONE'
        : r.contractIsManualOverride ? 'MANUAL_OVERRIDE' : 'SIGNED') as 'NONE' | 'MANUAL_OVERRIDE' | 'SIGNED',
    }));
  }

  async get(id: string): Promise<AgentDetail> {
    const row = await this.prisma.affiliateAgent.findUnique({
      where: { id },
      include: {
        _count: { select: { attributedLeads: true } },
        user: { select: { id: true } },
        trackingLinks: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, shortCode: true, channel: true, status: true,
            campaignLabel: true, clickCount: true, createdAt: true,
          },
        },
        attributedLeads: {
          select: {
            scorecardSubmission: { select: { band: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Affiliate agent not found.');

    const bandDistribution: Record<string, number> = {
      BAND_1: 0, BAND_2: 0, BAND_3: 0, BAND_4: 0, BAND_5: 0, BAND_6: 0,
    };
    for (const lead of row.attributedLeads) {
      const band = lead.scorecardSubmission?.band;
      if (band) bandDistribution[band] = (bandDistribution[band] ?? 0) + 1;
    }

    return {
      commissionRatePercent: row.commissionRatePercent,
      effectiveRatePercent: row.commissionRatePercent ?? AGENT_COMMISSION_RATE_PERCENT,
      usesCompanyDefault: row.commissionRatePercent === null,
      verified: !!row.verifiedAt,
      contractState: (!row.contractSignedAt
        ? 'NONE'
        : row.contractIsManualOverride ? 'MANUAL_OVERRIDE' : 'SIGNED') as 'NONE' | 'MANUAL_OVERRIDE' | 'SIGNED',
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      status: row.status,
      notes: row.notes,
      activeLinkCount: row.trackingLinks.filter((l) => l.status === 'ACTIVE').length,
      totalLeadCount: row._count.attributedLeads,
      links: row.trackingLinks.map((l) => ({
        id: l.id,
        shortCode: l.shortCode,
        channel: l.channel,
        status: l.status,
        campaignLabel: l.campaignLabel,
        clickCount: l.clickCount,
        createdAt: l.createdAt.toISOString(),
      })),
      bandDistribution,
      portalAccess: {
        hasLogin: !!row.userId,
        verified: !!row.verifiedAt,
        contracted: !!row.contractSignedAt,
        contractIsManualOverride: row.contractIsManualOverride,
        contractClearedByName: row.contractClearedByName,
        contractClearedReason: row.contractClearedReason,
        // Same three conditions the guard applies, in the same order.
        allowed: row.status === 'ACTIVE' && !!row.verifiedAt && !!row.contractSignedAt,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(dto: CreateAffiliateAgentDto, actor: Actor): Promise<AgentDetail> {
    const fullName = dto.fullName.trim();
    if (!fullName) throw new BadRequestException('Full name is required.');

    const email = dto.email?.trim() || null;

    const created = await this.prisma.$transaction(async (tx) => {
      // PR-AGENT-PORTAL phase 1 — an agent with an email gets a login here.
      //
      // Provisioned at creation rather than as a second deliberate step,
      // because the account is not what grants access: the gate is. A
      // provisioned agent can request a magic link and reach exactly one
      // screen, which tells them what is still outstanding. Making it a
      // separate action would add a state to test and no safety.
      //
      // No usable password is ever set. The hash below is random bytes that
      // no input can produce, so the only way in is a magic link to the
      // address the Owner entered.
      const userId = email ? await this.provisionLogin(tx, email, fullName) : null;

      const agent = await tx.affiliateAgent.create({
        data: {
          fullName,
          email,
          phone: dto.phone?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: actor.userId,
          userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CREATE',
          eventType: 'AFFILIATE_AGENT_CREATED',
          entityType: 'AFFILIATE_AGENT',
          entityId: agent.id,
          newValue: {
            agentId: agent.id,
            fullName: agent.fullName,
            hasEmail: !!agent.email,
            hasPhone: !!agent.phone,
            loginProvisioned: !!agent.userId,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return agent;
    });

    return this.get(created.id);
  }

  async update(
    id: string,
    dto: UpdateAffiliateAgentDto,
    actor: Actor,
  ): Promise<AgentDetail> {
    const existing = await this.prisma.affiliateAgent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Affiliate agent not found.');

    const data: Prisma.AffiliateAgentUpdateInput = {};
    const changedFields: string[] = [];
    if (dto.fullName !== undefined && dto.fullName.trim() !== existing.fullName) {
      data.fullName = dto.fullName.trim();
      changedFields.push('fullName');
    }
    if (dto.email !== undefined && (dto.email?.trim() || null) !== existing.email) {
      data.email = dto.email?.trim() || null;
      changedFields.push('email');
    }
    if (dto.phone !== undefined && (dto.phone?.trim() || null) !== existing.phone) {
      data.phone = dto.phone?.trim() || null;
      changedFields.push('phone');
    }
    if (dto.notes !== undefined && (dto.notes?.trim() || null) !== existing.notes) {
      data.notes = dto.notes?.trim() || null;
      changedFields.push('notes');
    }
    if (changedFields.length === 0) return this.get(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.affiliateAgent.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'UPDATE',
          eventType: 'AFFILIATE_AGENT_UPDATED',
          entityType: 'AFFILIATE_AGENT',
          entityId: id,
          newValue: { agentId: id, changedFields } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return this.get(id);
  }

  async changeStatus(
    id: string,
    status: AffiliateAgentStatus,
    actor: Actor,
  ): Promise<AgentDetail> {
    const existing = await this.prisma.affiliateAgent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Affiliate agent not found.');
    if (existing.status === status) return this.get(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.affiliateAgent.update({ where: { id }, data: { status } });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'UPDATE',
          eventType: 'AFFILIATE_AGENT_STATUS_CHANGED',
          entityType: 'AFFILIATE_AGENT',
          entityId: id,
          oldValue: { status: existing.status } as Prisma.InputJsonValue,
          newValue: { agentId: id, status, fullName: existing.fullName } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return this.get(id);
  }

  /**
   * Create (or reuse) the User an agent signs in as.
   *
   * Reuses an existing account when the address already belongs to one. An
   * email is one person: minting a second User for somebody who is already a
   * client or a staff member would split them in two, and the one-to-one
   * constraint on AffiliateAgent.userId would then be enforcing nothing useful.
   *
   * The password hash is 48 random bytes. bcrypt.compare against it can never
   * succeed for any input, so the account exists but has no password path —
   * magic link only.
   */
  private async provisionLogin(
    tx: Prisma.TransactionClient,
    email: string,
    fullName: string,
  ): Promise<string> {
    const normalized = email.toLowerCase();
    const existing = await tx.user.findUnique({
      where: { email: normalized },
      select: { id: true, affiliateAgent: { select: { id: true } } },
    });
    if (existing) {
      if (existing.affiliateAgent) {
        throw new ConflictException(
          'That email already belongs to another agent. Use a different address.',
        );
      }
      return existing.id;
    }

    const unusable = randomBytes(48).toString('base64');
    const user = await tx.user.create({
      data: {
        name: fullName,
        email: normalized,
        passwordHash: unusable,
        role: 'AGENT',
        isActive: true,
      },
      select: { id: true },
    });
    return user.id;
  }

  /**
   * Mark an agent as under contract without a contract.
   *
   * A stand-in until the DocuSeal flow arrives, and recorded as exactly that:
   * `contractIsManualOverride` stays true forever on this row, so a future
   * reader can tell which agents actually signed something. The reason is
   * required because "why is this agent live without a contract" is the
   * question an audit asks, and a blank answer makes the row unexplainable
   * rather than merely undocumented.
   *
   * OWNER only — enforced at the controller and re-checked here, so the rule
   * does not depend on the route shape.
   */
  // PR-AGENT-PORTAL-2 — this agent's history, read from the audit rows that
  // already exist. No new storage: every one of these events was already being
  // written and simply had nowhere to be seen.
  //
  // Deliberately NOT the whole audit log filtered by hand in the UI — the query
  // is scoped to this entity server-side, so a screen cannot accidentally widen
  // it. Read-only, and Owner/admin-tier by virtue of the controller.
  async history(id: string): Promise<AgentHistoryEntry[]> {
    const agent = await this.prisma.affiliateAgent.findUnique({ where: { id }, select: { id: true } });
    if (!agent) throw new NotFoundException('Affiliate agent not found.');

    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'AFFILIATE_AGENT', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, eventType: true, createdAt: true,
        actorNameSnapshot: true, actorRoleSnapshot: true,
        oldValue: true, newValue: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType ?? 'UNKNOWN',
      at: r.createdAt.toISOString(),
      actorName: r.actorNameSnapshot,
      actorRole: r.actorRoleSnapshot,
      summary: summariseAgentEvent(r.eventType, r.oldValue, r.newValue),
    }));
  }

  // PR-AGENT-PORTAL-2 — set (or clear) an agent's commission rate.
  //
  // OWNER only, re-checked HERE and not merely at the controller: this is the
  // field that decides what a person is paid, and a role check that lives only
  // in a decorator is one refactor away from being dropped. Same belt-and-braces
  // as clearContract above.
  //
  // NULL CLEARS, and that is deliberate and different from 0. Null means "no
  // per-agent rate — use the company default"; 0 means "we agreed nothing". The
  // payables deriver already reads `commissionRatePercent ?? AGENT_COMMISSION_
  // RATE_PERCENT`, so clearing restores the fallback exactly.
  //
  // NOT retroactive. AgentPayable snapshots the rate at derivation, so changing
  // it here never restates what an agent has already been told they are owed —
  // the same principle the payables ledger was built on.
  async setRate(id: string, ratePercent: number | null | undefined, actor: Actor): Promise<AgentDetail> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the Owner can change an agent commission rate.');
    }

    const next = ratePercent === undefined || ratePercent === null ? null : Number(ratePercent);
    if (next !== null) {
      // Bounds are enforced at the DTO too; repeated here because this method is
      // reachable from any future caller, not only that one HTTP route.
      if (!Number.isFinite(next) || next < 0 || next > 100) {
        throw new BadRequestException('Rate must be between 0 and 100 percent.');
      }
    }

    const existing = await this.prisma.affiliateAgent.findUnique({
      where: { id },
      select: { id: true, fullName: true, commissionRatePercent: true },
    });
    if (!existing) throw new NotFoundException('Affiliate agent not found.');

    const previous = existing.commissionRatePercent;
    if (previous === next) return this.get(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.affiliateAgent.update({ where: { id }, data: { commissionRatePercent: next } });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'UPDATE',
          eventType: 'AFFILIATE_AGENT_RATE_CHANGED',
          entityType: 'AFFILIATE_AGENT',
          entityId: id,
          // Old AND new, so the trail answers "what did it used to be" without
          // replaying every prior row.
          oldValue: { ratePercent: previous } as Prisma.InputJsonValue,
          newValue: {
            agentId: id,
            agentName: existing.fullName,
            ratePercent: next,
            previousRatePercent: previous,
            usesCompanyDefault: next === null,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return this.get(id);
  }

  async clearContract(id: string, reason: string, actor: Actor): Promise<AgentDetail> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the Owner can clear an agent contract.');
    }
    const clean = (reason ?? '').trim();
    if (clean.length < 3) {
      throw new BadRequestException(
        'Say why this agent may work without a signed contract — the reason is kept on the record.',
      );
    }

    const agent = await this.prisma.affiliateAgent.findUnique({
      where: { id },
      select: { id: true, fullName: true, contractSignedAt: true, contractIsManualOverride: true },
    });
    if (!agent) throw new NotFoundException('Affiliate agent not found.');
    if (agent.contractSignedAt) {
      throw new BadRequestException('That agent is already under contract.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.affiliateAgent.update({
        where: { id },
        data: {
          contractSignedAt: new Date(),
          contractIsManualOverride: true,
          contractClearedById: actor.userId,
          contractClearedByName: actor.name ?? null,
          contractClearedReason: clean,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          // Its own event type, not folded into a generic update: this is a
          // human deciding to bypass a control, and it should be findable as
          // that rather than buried among field edits.
          action: 'AGENT_CONTRACT_MANUALLY_CLEARED',
          eventType: 'AGENT_CONTRACT_MANUALLY_CLEARED',
          entityType: 'AFFILIATE_AGENT',
          entityId: id,
          newValue: {
            agentId: id,
            agentName: agent.fullName,
            reason: clean,
            manualOverride: true,
            note: 'No contract was signed. Cleared by hand pending the DocuSeal flow.',
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return this.get(id);
  }

  async delete(id: string, actor: Actor): Promise<{ deleted: true }> {
    // OWNER-only sub-gate enforced at the controller; we still defensively
    // re-check here so the service isn't dependent on the route shape.
    if (actor.role !== 'OWNER' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only OWNER can delete affiliate agents.');
    }

    const existing = await this.prisma.affiliateAgent.findUnique({
      where: { id },
      include: {
        trackingLinks: { select: { status: true } },
      },
    });
    if (!existing) throw new NotFoundException('Affiliate agent not found.');

    const activeLinks = existing.trackingLinks.filter((l) => l.status === 'ACTIVE').length;
    if (activeLinks > 0) {
      throw new ConflictException(
        `Cannot delete agent: ${activeLinks} active tracking link(s) reference them. Archive the links first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Links survive — they SET NULL on agentId per the FK.
      await tx.affiliateAgent.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'DELETE',
          eventType: 'AFFILIATE_AGENT_DELETED',
          entityType: 'AFFILIATE_AGENT',
          entityId: id,
          oldValue: {
            fullName: existing.fullName,
            archivedLinkCount: existing.trackingLinks.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return { deleted: true };
  }
}
