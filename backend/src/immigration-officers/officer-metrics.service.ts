import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-LIA-11 — Officer Metrics analytics service.
//
// Read-only. Builds aggregates over the PR-LIA-10 data layer
// (ImmigrationOfficer + CaseOfficerLinkage + ImmigrationOfficerObservation)
// for the OWNER-level platform dashboard and the per-officer trend
// section on the officer detail page.
//
// Per Decision 3A from PR-LIA-10 these are read-time aggregates — no
// counter columns, no maintained state. Window calculations anchor
// to start-of-month / start-of-quarter so partial-period skew at the
// boundary doesn't muddy the chart.
//
// Performance note: at Sorena's expected scale (<500 officers, <10000
// linkages) Prisma groupBy + count + findMany with the existing
// (officerId, linkedAt) / (linkedAt) indexes is fine. The handover
// documents when we'd need to denormalise a country column onto the
// linkage row.

const HIGH_DECLINE_RATE_THRESHOLD = 0.7;   // 70%
const HIGH_DECLINE_MIN_DECISIONS = 5;
const UNDER_OBSERVED_MIN_LINKAGES = 10;
const UNDER_OBSERVED_MAX_OBSERVATIONS = 2; // < 3 observations
const MOST_ACTIVE_WINDOW_DAYS = 30;
const NEW_ON_PLATFORM_WINDOW_DAYS = 7;
const OUTLIER_HIGH_DECLINE_WINDOW_MONTHS = 6;

export interface PlatformMetrics {
  windowMonths: number;
  generatedAt: string;
  totals: {
    totalOfficers: number;
    activeOfficers: number;
    totalLinkages: number;
    totalDecisions: number;
    approvedCount: number;
    declinedCount: number;
    pendingCount: number;
  };
  decisionsOverTime: Array<{
    monthLabel: string;
    monthStart: string;
    approved: number;
    declined: number;
    pending: number;
  }>;
  approvalRateLeaderboard: Array<{
    officerId: string;
    fullName: string;
    branch: string | null;
    totalDecisions: number;
    approvalRatePct: number;
    declineRatePct: number;
  }>;
  topCountries: Array<{
    country: string;
    caseCount: number;
    approvedCount: number;
    declinedCount: number;
  }>;
  caseStageDistribution: Array<{
    stage: string;
    count: number;
  }>;
}

export interface PlatformOutliers {
  generatedAt: string;
  highDeclineRate: Array<{
    officerId: string;
    fullName: string;
    branch: string | null;
    totalDecisions: number;
    declineRatePct: number;
  }>;
  underObserved: Array<{
    officerId: string;
    fullName: string;
    totalLinkages: number;
    observationCount: number;
  }>;
  mostActive: Array<{
    officerId: string;
    fullName: string;
    branch: string | null;
    recentLinkageCount: number;
  }>;
  newOnPlatform: Array<{
    officerId: string;
    fullName: string;
    firstLinkedAt: string;
  }>;
  thresholds: {
    highDeclineRatePct: number;
    highDeclineMinDecisions: number;
    underObservedMinLinkages: number;
    underObservedMaxObservations: number;
    mostActiveWindowDays: number;
    newOnPlatformWindowDays: number;
    highDeclineWindowMonths: number;
  };
}

export interface OfficerTrend {
  officerId: string;
  windowMonths: number;
  generatedAt: string;
  quarterlyDecisions: Array<{
    quarterLabel: string;
    quarterStart: string;
    approved: number;
    declined: number;
    pending: number;
  }>;
  topCountries: Array<{
    country: string;
    caseCount: number;
  }>;
  caseStageDistribution: Array<{
    stage: string;
    count: number;
  }>;
  daysSinceLastLinkage: number | null;
}

@Injectable()
export class OfficerMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Platform metrics ──────────────────────────────────────────────────

  async getPlatformMetrics(windowMonths: number): Promise<PlatformMetrics> {
    this.assertWindow(windowMonths);

    const now = new Date();
    const windowStart = this.startOfMonth(now, -windowMonths + 1);

    // 1. Counts in window
    const [
      totalOfficers,
      linkagesInWindow,
      activeOfficerGroups,
    ] = await Promise.all([
      this.prisma.immigrationOfficer.count(),
      this.prisma.caseOfficerLinkage.findMany({
        where: { linkedAt: { gte: windowStart } },
        select: { id: true, linkedAt: true, linkedOutcome: true, officerId: true, caseId: true },
      }),
      this.prisma.caseOfficerLinkage.groupBy({
        by: ['officerId'],
        where: { linkedAt: { gte: windowStart } },
      }),
    ]);

    let approved = 0;
    let declined = 0;
    let pending = 0;
    for (const l of linkagesInWindow) {
      if (l.linkedOutcome === 'APPROVED') approved++;
      else if (l.linkedOutcome === 'DECLINED') declined++;
      else pending++;
    }

    const totals: PlatformMetrics['totals'] = {
      totalOfficers,
      activeOfficers: activeOfficerGroups.length,
      totalLinkages: linkagesInWindow.length,
      totalDecisions: approved + declined,
      approvedCount: approved,
      declinedCount: declined,
      pendingCount: pending,
    };

    // 2. Decisions over time — monthly buckets across the window
    const monthBuckets = this.buildMonthBuckets(windowStart, now);
    for (const l of linkagesInWindow) {
      const bucketKey = this.monthBucketKey(l.linkedAt);
      const bucket = monthBuckets.get(bucketKey);
      if (!bucket) continue;
      if (l.linkedOutcome === 'APPROVED') bucket.approved++;
      else if (l.linkedOutcome === 'DECLINED') bucket.declined++;
      else bucket.pending++;
    }
    const decisionsOverTime = [...monthBuckets.values()];

    // 3. Approval-rate leaderboard — top 10 officers by total decisions
    const decisionsByOfficer = await this.prisma.caseOfficerLinkage.groupBy({
      by: ['officerId', 'linkedOutcome'],
      where: {
        linkedAt: { gte: windowStart },
        linkedOutcome: { not: null },
      },
      _count: { _all: true },
    });
    const officerDecisionStats = new Map<
      string,
      { approved: number; declined: number; total: number }
    >();
    for (const g of decisionsByOfficer) {
      const stats = officerDecisionStats.get(g.officerId) ?? { approved: 0, declined: 0, total: 0 };
      const c = g._count?._all ?? 0;
      if (g.linkedOutcome === 'APPROVED') stats.approved += c;
      else if (g.linkedOutcome === 'DECLINED') stats.declined += c;
      stats.total = stats.approved + stats.declined;
      officerDecisionStats.set(g.officerId, stats);
    }
    const topOfficerIds = [...officerDecisionStats.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([id]) => id);
    const officerDetails = topOfficerIds.length > 0
      ? await this.prisma.immigrationOfficer.findMany({
          where: { id: { in: topOfficerIds } },
          select: { id: true, fullName: true, branch: true },
        })
      : [];
    const officerById = new Map(officerDetails.map((o) => [o.id, o]));
    const approvalRateLeaderboard = topOfficerIds.map((id) => {
      const stats = officerDecisionStats.get(id)!;
      const det = officerById.get(id);
      const approvalRatePct = stats.total > 0 ? Math.round((stats.approved / stats.total) * 1000) / 10 : 0;
      const declineRatePct = stats.total > 0 ? Math.round((stats.declined / stats.total) * 1000) / 10 : 0;
      return {
        officerId: id,
        fullName: det?.fullName ?? 'Unknown',
        branch: det?.branch ?? null,
        totalDecisions: stats.total,
        approvalRatePct,
        declineRatePct,
      };
    });

    // 4. Top countries — derived from linkage → case → lead → contact
    const linkagesWithCountry = await this.prisma.caseOfficerLinkage.findMany({
      where: { linkedAt: { gte: windowStart } },
      select: {
        linkedOutcome: true,
        case: {
          select: {
            lead: {
              select: {
                contact: { select: { countryOfResidence: true } },
              },
            },
          },
        },
      },
    });
    const countryStats = new Map<string, { caseCount: number; approvedCount: number; declinedCount: number }>();
    for (const l of linkagesWithCountry) {
      const c = l.case.lead?.contact?.countryOfResidence ?? null;
      if (!c) continue;
      const stats = countryStats.get(c) ?? { caseCount: 0, approvedCount: 0, declinedCount: 0 };
      stats.caseCount++;
      if (l.linkedOutcome === 'APPROVED') stats.approvedCount++;
      else if (l.linkedOutcome === 'DECLINED') stats.declinedCount++;
      countryStats.set(c, stats);
    }
    const topCountries = [...countryStats.entries()]
      .sort((a, b) => b[1].caseCount - a[1].caseCount)
      .slice(0, 10)
      .map(([country, s]) => ({ country, ...s }));

    // 5. Case stage distribution at link time
    const stageGroups = await this.prisma.caseOfficerLinkage.findMany({
      where: { linkedAt: { gte: windowStart } },
      select: { case: { select: { stage: true } } },
    });
    const stageCounts = new Map<string, number>();
    for (const s of stageGroups) {
      const k = String(s.case.stage);
      stageCounts.set(k, (stageCounts.get(k) ?? 0) + 1);
    }
    const caseStageDistribution = [...stageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([stage, count]) => ({ stage, count }));

    return {
      windowMonths,
      generatedAt: now.toISOString(),
      totals,
      decisionsOverTime,
      approvalRateLeaderboard,
      topCountries,
      caseStageDistribution,
    };
  }

  // ─── Outlier scan ──────────────────────────────────────────────────────

  async getPlatformOutliers(): Promise<PlatformOutliers> {
    const now = new Date();
    const declineWindowStart = this.startOfMonth(now, -OUTLIER_HIGH_DECLINE_WINDOW_MONTHS + 1);
    const mostActiveStart = new Date(now.getTime() - MOST_ACTIVE_WINDOW_DAYS * 86_400_000);
    const newWindowStart = new Date(now.getTime() - NEW_ON_PLATFORM_WINDOW_DAYS * 86_400_000);

    // High decline rate
    const recentDecisions = await this.prisma.caseOfficerLinkage.groupBy({
      by: ['officerId', 'linkedOutcome'],
      where: {
        linkedAt: { gte: declineWindowStart },
        linkedOutcome: { not: null },
      },
      _count: { _all: true },
    });
    const declineStats = new Map<
      string,
      { approved: number; declined: number; total: number }
    >();
    for (const g of recentDecisions) {
      const s = declineStats.get(g.officerId) ?? { approved: 0, declined: 0, total: 0 };
      const c = g._count?._all ?? 0;
      if (g.linkedOutcome === 'APPROVED') s.approved += c;
      else if (g.linkedOutcome === 'DECLINED') s.declined += c;
      s.total = s.approved + s.declined;
      declineStats.set(g.officerId, s);
    }
    const highDeclineIds: string[] = [];
    const highDeclineRows: Array<{ officerId: string; totalDecisions: number; declineRatePct: number }> = [];
    for (const [officerId, s] of declineStats) {
      if (s.total >= HIGH_DECLINE_MIN_DECISIONS && s.declined / s.total >= HIGH_DECLINE_RATE_THRESHOLD) {
        highDeclineIds.push(officerId);
        highDeclineRows.push({
          officerId,
          totalDecisions: s.total,
          declineRatePct: Math.round((s.declined / s.total) * 1000) / 10,
        });
      }
    }
    const highDeclineOfficers = highDeclineIds.length > 0
      ? await this.prisma.immigrationOfficer.findMany({
          where: { id: { in: highDeclineIds } },
          select: { id: true, fullName: true, branch: true },
        })
      : [];
    const hdById = new Map(highDeclineOfficers.map((o) => [o.id, o]));
    const highDeclineRate = highDeclineRows
      .sort((a, b) => b.declineRatePct - a.declineRatePct)
      .map((r) => ({
        officerId: r.officerId,
        fullName: hdById.get(r.officerId)?.fullName ?? 'Unknown',
        branch: hdById.get(r.officerId)?.branch ?? null,
        totalDecisions: r.totalDecisions,
        declineRatePct: r.declineRatePct,
      }));

    // Under-observed — many linkages, few observations
    const linkageCounts = await this.prisma.caseOfficerLinkage.groupBy({
      by: ['officerId'],
      _count: { _all: true },
    });
    const heavyLinkageIds = linkageCounts
      .filter((g) => (g._count?._all ?? 0) >= UNDER_OBSERVED_MIN_LINKAGES)
      .map((g) => g.officerId);
    const observationCounts = heavyLinkageIds.length > 0
      ? await this.prisma.immigrationOfficerObservation.groupBy({
          by: ['officerId'],
          where: { officerId: { in: heavyLinkageIds } },
          _count: { _all: true },
        })
      : [];
    const obsById = new Map(observationCounts.map((g) => [g.officerId, g._count?._all ?? 0]));
    const underObservedIds = heavyLinkageIds.filter(
      (id) => (obsById.get(id) ?? 0) <= UNDER_OBSERVED_MAX_OBSERVATIONS,
    );
    const underObservedDetails = underObservedIds.length > 0
      ? await this.prisma.immigrationOfficer.findMany({
          where: { id: { in: underObservedIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const uoById = new Map(underObservedDetails.map((o) => [o.id, o.fullName]));
    const underObserved = underObservedIds
      .map((id) => ({
        officerId: id,
        fullName: uoById.get(id) ?? 'Unknown',
        totalLinkages: linkageCounts.find((l) => l.officerId === id)?._count?._all ?? 0,
        observationCount: obsById.get(id) ?? 0,
      }))
      .sort((a, b) => b.totalLinkages - a.totalLinkages);

    // Most active (last 30 days)
    const recentLinkages = await this.prisma.caseOfficerLinkage.groupBy({
      by: ['officerId'],
      where: { linkedAt: { gte: mostActiveStart } },
      _count: { _all: true },
    });
    const recentTop = recentLinkages
      .sort((a, b) => (b._count?._all ?? 0) - (a._count?._all ?? 0))
      .slice(0, 5);
    const recentIds = recentTop.map((g) => g.officerId);
    const recentDetails = recentIds.length > 0
      ? await this.prisma.immigrationOfficer.findMany({
          where: { id: { in: recentIds } },
          select: { id: true, fullName: true, branch: true },
        })
      : [];
    const rById = new Map(recentDetails.map((o) => [o.id, o]));
    const mostActive = recentTop.map((g) => ({
      officerId: g.officerId,
      fullName: rById.get(g.officerId)?.fullName ?? 'Unknown',
      branch: rById.get(g.officerId)?.branch ?? null,
      recentLinkageCount: g._count?._all ?? 0,
    }));

    // New on platform — first linkage in last 7 days
    const allOfficerFirsts = await this.prisma.caseOfficerLinkage.groupBy({
      by: ['officerId'],
      _min: { linkedAt: true },
    });
    const newIds = allOfficerFirsts
      .filter((g) => g._min.linkedAt && g._min.linkedAt >= newWindowStart)
      .sort((a, b) => (a._min.linkedAt?.getTime() ?? 0) - (b._min.linkedAt?.getTime() ?? 0))
      .map((g) => g.officerId);
    const newDetails = newIds.length > 0
      ? await this.prisma.immigrationOfficer.findMany({
          where: { id: { in: newIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nById = new Map(newDetails.map((o) => [o.id, o.fullName]));
    const newOnPlatform = newIds.map((id) => {
      const first = allOfficerFirsts.find((g) => g.officerId === id)?._min.linkedAt ?? new Date(0);
      return {
        officerId: id,
        fullName: nById.get(id) ?? 'Unknown',
        firstLinkedAt: first.toISOString(),
      };
    });

    return {
      generatedAt: now.toISOString(),
      highDeclineRate,
      underObserved,
      mostActive,
      newOnPlatform,
      thresholds: {
        highDeclineRatePct: HIGH_DECLINE_RATE_THRESHOLD * 100,
        highDeclineMinDecisions: HIGH_DECLINE_MIN_DECISIONS,
        underObservedMinLinkages: UNDER_OBSERVED_MIN_LINKAGES,
        underObservedMaxObservations: UNDER_OBSERVED_MAX_OBSERVATIONS,
        mostActiveWindowDays: MOST_ACTIVE_WINDOW_DAYS,
        newOnPlatformWindowDays: NEW_ON_PLATFORM_WINDOW_DAYS,
        highDeclineWindowMonths: OUTLIER_HIGH_DECLINE_WINDOW_MONTHS,
      },
    };
  }

  // ─── Per-officer trend ─────────────────────────────────────────────────

  async getOfficerTrend(officerId: string, windowMonths: number): Promise<OfficerTrend> {
    this.assertWindow(windowMonths);

    const officer = await this.prisma.immigrationOfficer.findUnique({
      where: { id: officerId },
      select: { id: true },
    });
    if (!officer) throw new NotFoundException('Officer not found');

    const now = new Date();
    const windowStart = this.startOfMonth(now, -windowMonths + 1);

    const linkages = await this.prisma.caseOfficerLinkage.findMany({
      where: { officerId, linkedAt: { gte: windowStart } },
      select: {
        linkedAt: true,
        linkedOutcome: true,
        case: {
          select: {
            stage: true,
            lead: { select: { contact: { select: { countryOfResidence: true } } } },
          },
        },
      },
      orderBy: { linkedAt: 'desc' },
    });

    // Quarterly buckets
    const quarterBuckets = this.buildQuarterBuckets(windowStart, now);
    for (const l of linkages) {
      const key = this.quarterBucketKey(l.linkedAt);
      const bucket = quarterBuckets.get(key);
      if (!bucket) continue;
      if (l.linkedOutcome === 'APPROVED') bucket.approved++;
      else if (l.linkedOutcome === 'DECLINED') bucket.declined++;
      else bucket.pending++;
    }
    const quarterlyDecisions = [...quarterBuckets.values()];

    // Top 5 countries
    const countryCounts = new Map<string, number>();
    for (const l of linkages) {
      const c = l.case.lead?.contact?.countryOfResidence ?? null;
      if (!c) continue;
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
    const topCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, caseCount]) => ({ country, caseCount }));

    // Stage distribution
    const stageCounts = new Map<string, number>();
    for (const l of linkages) {
      const k = String(l.case.stage);
      stageCounts.set(k, (stageCounts.get(k) ?? 0) + 1);
    }
    const caseStageDistribution = [...stageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([stage, count]) => ({ stage, count }));

    // Days since last linkage (any linkage, not just in window)
    const last = await this.prisma.caseOfficerLinkage.findFirst({
      where: { officerId },
      orderBy: { linkedAt: 'desc' },
      select: { linkedAt: true },
    });
    const daysSinceLastLinkage = last
      ? Math.floor((now.getTime() - last.linkedAt.getTime()) / 86_400_000)
      : null;

    return {
      officerId,
      windowMonths,
      generatedAt: now.toISOString(),
      quarterlyDecisions,
      topCountries,
      caseStageDistribution,
      daysSinceLastLinkage,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private assertWindow(months: number): void {
    if (months !== 6 && months !== 12) {
      throw new BadRequestException('windowMonths must be 6 or 12.');
    }
  }

  // Start of month N months from `anchor`. Returns UTC Date at 00:00.
  private startOfMonth(anchor: Date, monthOffset: number): Date {
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + monthOffset;
    return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  }

  private buildMonthBuckets(start: Date, end: Date): Map<string, {
    monthLabel: string;
    monthStart: string;
    approved: number;
    declined: number;
    pending: number;
  }> {
    const buckets = new Map<string, {
      monthLabel: string;
      monthStart: string;
      approved: number;
      declined: number;
      pending: number;
    }>();
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    let cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      const key = this.monthBucketKey(cursor);
      buckets.set(key, {
        monthLabel: fmt.format(cursor),
        monthStart: cursor.toISOString(),
        approved: 0,
        declined: 0,
        pending: 0,
      });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    }
    return buckets;
  }

  private monthBucketKey(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private buildQuarterBuckets(start: Date, end: Date): Map<string, {
    quarterLabel: string;
    quarterStart: string;
    approved: number;
    declined: number;
    pending: number;
  }> {
    const buckets = new Map<string, {
      quarterLabel: string;
      quarterStart: string;
      approved: number;
      declined: number;
      pending: number;
    }>();
    // Start cursor at the quarter containing `start`.
    const startQuarter = Math.floor(start.getUTCMonth() / 3);
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), startQuarter * 3, 1, 0, 0, 0, 0));
    while (cursor.getTime() <= end.getTime()) {
      const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
      const key = `${cursor.getUTCFullYear()}-Q${q}`;
      buckets.set(key, {
        quarterLabel: `Q${q} ${cursor.getUTCFullYear()}`,
        quarterStart: cursor.toISOString(),
        approved: 0,
        declined: 0,
        pending: 0,
      });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 3, 1, 0, 0, 0, 0));
    }
    return buckets;
  }

  private quarterBucketKey(d: Date): string {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `${d.getUTCFullYear()}-Q${q}`;
  }
}
