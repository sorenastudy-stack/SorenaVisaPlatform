import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { AffiliateAgentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
}

export interface AgentDetail extends AgentListItem {
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
    }));
  }

  async get(id: string): Promise<AgentDetail> {
    const row = await this.prisma.affiliateAgent.findUnique({
      where: { id },
      include: {
        _count: { select: { attributedLeads: true } },
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(dto: CreateAffiliateAgentDto, actor: Actor): Promise<AgentDetail> {
    const fullName = dto.fullName.trim();
    if (!fullName) throw new BadRequestException('Full name is required.');

    const created = await this.prisma.$transaction(async (tx) => {
      const agent = await tx.affiliateAgent.create({
        data: {
          fullName,
          email: dto.email?.trim() || null,
          phone: dto.phone?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: actor.userId,
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
