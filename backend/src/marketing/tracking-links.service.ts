import {
  BadRequestException, ConflictException, Injectable,
  Logger, NotFoundException,
} from '@nestjs/common';
import {
  MarketingChannelType, Prisma, TrackingLinkStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrackingLinkDto } from './dto/marketing.dto';

// PR-SCORECARD-2 — TrackingLink service.
//
// Each TrackingLink represents one short URL that funnels clicks
// toward the scorecard landing page. Clicks are recorded individually
// (`tracking_link_clicks`) AND aggregated (`clickCount`) so the index
// page is fast.
//
// Stats (`getStats`) re-derives conversion metrics on read — no
// maintained counters for signups / submissions / band distribution,
// per the PR-LIA-10 "Decision 3A" pattern (read-time aggregates).

interface Actor {
  userId: string;
  name: string | null;
  role: string;
}

export interface TrackingLinkRow {
  id: string;
  shortCode: string;
  shortUrl: string;
  channel: MarketingChannelType;
  agentId: string | null;
  agentName: string | null;
  campaignLabel: string | null;
  destination: string;
  status: TrackingLinkStatus;
  clickCount: number;
  attributedLeadCount: number;
  conversionRate: number; // 0..1
  createdAt: string;
  archivedAt: string | null;
}

export interface TrackingLinkStats {
  linkId: string;
  shortCode: string;
  channel: MarketingChannelType;
  agentName: string | null;
  campaignLabel: string | null;
  clicks: number;
  signups: number;
  scorecardCompletions: number;
  bandDistribution: Record<string, number>;
  windowDays: number;
}

const SHORT_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SHORT_CODE_LENGTH = 6;
const MAX_COLLISION_RETRIES = 5;

@Injectable()
export class TrackingLinksService {
  private readonly logger = new Logger(TrackingLinksService.name);

  constructor(private readonly prisma: PrismaService) {}

  private webBaseUrl(): string {
    return (process.env.WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  private shortUrl(shortCode: string): string {
    return `${this.webBaseUrl()}/s/${shortCode}`;
  }

  private generateShortCode(): string {
    let out = '';
    for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
      const idx = Math.floor(Math.random() * SHORT_CODE_ALPHABET.length);
      out += SHORT_CODE_ALPHABET[idx];
    }
    return out;
  }

  async list(opts: {
    channel?: MarketingChannelType;
    agentId?: string;
    status?: TrackingLinkStatus;
    search?: string;
  }): Promise<TrackingLinkRow[]> {
    const where: Prisma.TrackingLinkWhereInput = {};
    if (opts.channel) where.channel = opts.channel;
    if (opts.agentId) where.agentId = opts.agentId;
    if (opts.status) where.status = opts.status;
    if (opts.search && opts.search.trim()) {
      where.OR = [
        { shortCode: { contains: opts.search.trim(), mode: 'insensitive' } },
        { campaignLabel: { contains: opts.search.trim(), mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.trackingLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        agent: { select: { id: true, fullName: true } },
        _count: { select: { attributedLeads: true } },
      },
      take: 200,
    });
    return rows.map((r) => this.toRow(r));
  }

  async get(id: string): Promise<TrackingLinkRow> {
    const row = await this.prisma.trackingLink.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, fullName: true } },
        _count: { select: { attributedLeads: true } },
      },
    });
    if (!row) throw new NotFoundException('Tracking link not found.');
    return this.toRow(row);
  }

  async create(dto: CreateTrackingLinkDto, actor: Actor): Promise<TrackingLinkRow> {
    // Validate agent exists (if specified) and is not TERMINATED.
    if (dto.agentId) {
      const agent = await this.prisma.affiliateAgent.findUnique({
        where: { id: dto.agentId },
      });
      if (!agent) throw new BadRequestException('Affiliate agent not found.');
      if (agent.status === 'TERMINATED') {
        throw new ConflictException('Cannot create tracking links for terminated agents.');
      }
    }

    // Build destination. If a hosted scorecard landing exists at WEB_BASE,
    // /scorecard/landing is the default. We append channel/agent/campaign
    // as query params so even if the cookie is wiped, the form can still
    // recover attribution from the URL.
    const baseDestination = (dto.destination?.trim() || '/scorecard/landing');
    const isAbsolute = /^https?:\/\//i.test(baseDestination);
    const targetBase = isAbsolute ? baseDestination : `${this.webBaseUrl()}${baseDestination.startsWith('/') ? '' : '/'}${baseDestination}`;
    const url = new URL(targetBase);
    url.searchParams.set('ch', dto.channel.toLowerCase());
    if (dto.agentId) url.searchParams.set('agent', dto.agentId);
    if (dto.campaignLabel) url.searchParams.set('campaign', dto.campaignLabel);
    const destination = url.toString();

    // Collision-retry loop for short code uniqueness.
    let shortCode: string | null = null;
    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const candidate = this.generateShortCode();
      const existing = await this.prisma.trackingLink.findUnique({
        where: { shortCode: candidate },
        select: { id: true },
      });
      if (!existing) {
        shortCode = candidate;
        break;
      }
    }
    if (!shortCode) {
      throw new ConflictException(
        'Could not generate a unique short code after several retries. Please try again.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const link = await tx.trackingLink.create({
        data: {
          shortCode: shortCode!,
          channel: dto.channel,
          agentId: dto.agentId ?? null,
          campaignLabel: dto.campaignLabel?.trim() || null,
          destination,
          createdById: actor.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CREATE',
          eventType: 'TRACKING_LINK_CREATED',
          entityType: 'TRACKING_LINK',
          entityId: link.id,
          newValue: {
            linkId: link.id,
            shortCode: link.shortCode,
            channel: link.channel,
            agentId: link.agentId,
            campaignLabel: link.campaignLabel,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return link;
    });

    return this.get(created.id);
  }

  async archive(id: string, actor: Actor): Promise<TrackingLinkRow> {
    const existing = await this.prisma.trackingLink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tracking link not found.');
    if (existing.status === 'ARCHIVED') return this.get(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.trackingLink.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'UPDATE',
          eventType: 'TRACKING_LINK_ARCHIVED',
          entityType: 'TRACKING_LINK',
          entityId: id,
          newValue: {
            linkId: id,
            shortCode: existing.shortCode,
            channel: existing.channel,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return this.get(id);
  }

  async recordClick(
    shortCode: string,
    req: { ip?: string; headers: Record<string, unknown> },
  ): Promise<{ destination: string; linkId: string } | null> {
    const link = await this.prisma.trackingLink.findUnique({
      where: { shortCode },
      select: { id: true, status: true, destination: true },
    });
    if (!link || link.status === 'ARCHIVED') return null;

    const ua = typeof req.headers['user-agent'] === 'string'
      ? (req.headers['user-agent'] as string)
      : null;
    const ref = typeof req.headers.referer === 'string'
      ? (req.headers.referer as string)
      : (typeof req.headers.referrer === 'string' ? (req.headers.referrer as string) : null);
    const fwd = req.headers['x-forwarded-for'];
    const ip = typeof fwd === 'string' && fwd.length > 0
      ? fwd.split(',')[0]!.trim()
      : (req.ip ?? null);

    // Per-click row + counter increment in a single transaction.
    await this.prisma.$transaction(async (tx) => {
      await tx.trackingLinkClick.create({
        data: {
          linkId: link.id,
          ipAddress: ip ?? null,
          userAgent: ua ?? null,
          referer: ref ?? null,
        },
      });
      await tx.trackingLink.update({
        where: { id: link.id },
        data: { clickCount: { increment: 1 } },
      });
    });

    return { destination: link.destination, linkId: link.id };
  }

  async getStats(linkId: string, windowDays: number): Promise<TrackingLinkStats> {
    if (!Number.isFinite(windowDays) || windowDays <= 0) windowDays = 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const link = await this.prisma.trackingLink.findUnique({
      where: { id: linkId },
      include: { agent: { select: { fullName: true } } },
    });
    if (!link) throw new NotFoundException('Tracking link not found.');

    const [clicks, attributedLeads] = await Promise.all([
      this.prisma.trackingLinkClick.count({
        where: { linkId: link.id, clickedAt: { gte: since } },
      }),
      this.prisma.lead.findMany({
        where: { trackingLinkId: link.id, createdAt: { gte: since } },
        select: {
          scorecardSubmission: { select: { band: true, isDraft: true } },
        },
      }),
    ]);

    const bandDistribution: Record<string, number> = {
      BAND_1: 0, BAND_2: 0, BAND_3: 0, BAND_4: 0, BAND_5: 0, BAND_6: 0,
    };
    let scorecardCompletions = 0;
    for (const lead of attributedLeads) {
      const sub = lead.scorecardSubmission;
      if (sub && !sub.isDraft) {
        scorecardCompletions++;
        bandDistribution[sub.band] = (bandDistribution[sub.band] ?? 0) + 1;
      }
    }

    return {
      linkId: link.id,
      shortCode: link.shortCode,
      channel: link.channel,
      agentName: link.agent?.fullName ?? null,
      campaignLabel: link.campaignLabel,
      clicks,
      signups: attributedLeads.length,
      scorecardCompletions,
      bandDistribution,
      windowDays,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private toRow(r: {
    id: string;
    shortCode: string;
    channel: MarketingChannelType;
    agentId: string | null;
    campaignLabel: string | null;
    destination: string;
    status: TrackingLinkStatus;
    clickCount: number;
    createdAt: Date;
    archivedAt: Date | null;
    agent: { id: string; fullName: string } | null;
    _count: { attributedLeads: number };
  }): TrackingLinkRow {
    const attributedLeadCount = r._count.attributedLeads;
    const conversionRate = r.clickCount > 0
      ? attributedLeadCount / r.clickCount
      : 0;
    return {
      id: r.id,
      shortCode: r.shortCode,
      shortUrl: this.shortUrl(r.shortCode),
      channel: r.channel,
      agentId: r.agentId,
      agentName: r.agent?.fullName ?? null,
      campaignLabel: r.campaignLabel,
      destination: r.destination,
      status: r.status,
      clickCount: r.clickCount,
      attributedLeadCount,
      conversionRate,
      createdAt: r.createdAt.toISOString(),
      archivedAt: r.archivedAt?.toISOString() ?? null,
    };
  }
}
