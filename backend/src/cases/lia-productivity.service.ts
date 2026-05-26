import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-LIA-3 — Per-LIA productivity metrics.
//
// The roster query is N+1 by design — one query per LIA for the
// case-list, then in-memory derivation of the six metrics. Staff
// count is small (single-digit LIAs); a single tabular SQL with
// LATERAL joins would be premature optimisation. Documented in the
// PR-LIA-3 handover §8 so future-you knows when to revisit.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export interface LiaProductivityRow {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  openCases: number;
  totalAssigned: number;
  avgDaysToFirstAction: number | null;
  avgDaysToResolution: number | null;
  decisionsThisMonth: number;
  avgClientResponseHours: number | null;
}

@Injectable()
export class LiaProductivityService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public API ────────────────────────────────────────────────────────

  async getRoster(): Promise<{ rows: LiaProductivityRow[]; generatedAt: string }> {
    const lias = await this.prisma.user.findMany({
      where: {
        role: 'LIA',
        // Roster includes BOTH active and archived LIAs so the report
        // can show a recent archive's historical numbers. The `isActive`
        // field is surfaced on the row for UI labelling.
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        staffActiveStatus: { select: { isActive: true } },
      },
    });

    const rows = await Promise.all(
      lias.map((lia) =>
        this.computeStatsFor({
          id: lia.id,
          name: lia.name,
          email: lia.email,
          isActive:
            lia.isActive &&
            (lia.staffActiveStatus?.isActive !== false),
        }),
      ),
    );

    rows.sort((a, b) => {
      if (b.openCases !== a.openCases) return b.openCases - a.openCases;
      return a.name.localeCompare(b.name);
    });

    return { rows, generatedAt: new Date().toISOString() };
  }

  async getMyStats(liaUserId: string): Promise<LiaProductivityRow> {
    const lia = await this.prisma.user.findUnique({
      where: { id: liaUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        staffActiveStatus: { select: { isActive: true } },
      },
    });
    if (!lia || lia.role !== 'LIA') {
      throw new NotFoundException('LIA not found');
    }
    return this.computeStatsFor({
      id: lia.id,
      name: lia.name,
      email: lia.email,
      isActive: lia.isActive && lia.staffActiveStatus?.isActive !== false,
    });
  }

  // ─── Per-LIA computation ───────────────────────────────────────────────

  private async computeStatsFor(lia: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
  }): Promise<LiaProductivityRow> {
    // One pass: pull every case ever assigned to this LIA with the
    // event timestamps we need for the time-based metrics.
    const cases = await this.prisma.case.findMany({
      where: { liaId: lia.id },
      select: {
        id: true,
        stage: true,
        liaAssignedAt: true,
        createdAt: true,
        updatedAt: true,
        // First LIA-authored note OR decision on this case.
        legalNotes: {
          where: { authorId: lia.id },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true, createdAt: true, decision: true },
        },
        // First LIA-authored message on this case.
        caseMessages: {
          where: { authorId: lia.id, authorRole: 'LIA' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true, createdAt: true },
        },
      },
    });

    const openCases = cases.filter(
      (c) => c.stage !== 'COMPLETED' && c.stage !== 'WITHDRAWN',
    ).length;
    const totalAssigned = cases.length;

    // avgDaysToFirstAction — for each case where this LIA has at
    // least one action (legal note OR outbound message OR — implicitly
    // — a risk/hard-stop change which lives in audit logs but is
    // outside the scope of this PR), compute days between
    // liaAssignedAt and the earliest action. Skip cases with no
    // liaAssignedAt timestamp (post-backfill, every case should have
    // one — but be defensive).
    const firstActionDays: number[] = [];
    for (const c of cases) {
      if (!c.liaAssignedAt) continue;
      const earliest = this.earliestActionMs(c);
      if (earliest === null) continue;
      const delta = earliest - c.liaAssignedAt.getTime();
      if (delta < 0) continue;
      firstActionDays.push(delta / MS_PER_DAY);
    }

    // avgDaysToResolution — for cases now in a terminal stage, use
    // (updatedAt - liaAssignedAt) as a proxy for "time-on-LIA-desk".
    const resolutionDays: number[] = [];
    for (const c of cases) {
      if (!c.liaAssignedAt) continue;
      if (c.stage !== 'COMPLETED' && c.stage !== 'WITHDRAWN') continue;
      const delta = c.updatedAt.getTime() - c.liaAssignedAt.getTime();
      if (delta < 0) continue;
      resolutionDays.push(delta / MS_PER_DAY);
    }

    // decisionsThisMonth — LegalNote rows authored by this LIA where
    // decision IS NOT NULL and createdAt is in the current calendar
    // month (server timezone — Pacific/Auckland in prod).
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const decisionsThisMonth = await this.prisma.legalNote.count({
      where: {
        authorId: lia.id,
        decision: { not: null },
        createdAt: { gte: monthStart },
      },
    });

    // avgClientResponseHours — for every CLIENT message on a case
    // assigned to this LIA, find the next LIA-authored message on
    // the same case and average the gaps. Pulled in one query so we
    // don't fire N more queries per case.
    const avgClientResponseHours = await this.computeAvgClientResponseHours(lia.id);

    return {
      id: lia.id,
      name: lia.name,
      email: lia.email,
      isActive: lia.isActive,
      openCases,
      totalAssigned,
      avgDaysToFirstAction: firstActionDays.length
        ? round1(firstActionDays.reduce((s, x) => s + x, 0) / firstActionDays.length)
        : null,
      avgDaysToResolution: resolutionDays.length
        ? round1(resolutionDays.reduce((s, x) => s + x, 0) / resolutionDays.length)
        : null,
      decisionsThisMonth,
      avgClientResponseHours,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private earliestActionMs(c: {
    legalNotes: { createdAt: Date }[];
    caseMessages: { createdAt: Date }[];
  }): number | null {
    const candidates: number[] = [];
    if (c.legalNotes.length) candidates.push(c.legalNotes[0]!.createdAt.getTime());
    if (c.caseMessages.length) candidates.push(c.caseMessages[0]!.createdAt.getTime());
    return candidates.length ? Math.min(...candidates) : null;
  }

  private async computeAvgClientResponseHours(liaId: string): Promise<number | null> {
    // Pull all messages on cases assigned to this LIA, oldest first,
    // grouped per case in memory. For each CLIENT message that is
    // followed by an LIA message, record the gap. Average across all
    // such pairs.
    const cases = await this.prisma.case.findMany({
      where: { liaId },
      select: { id: true },
    });
    if (cases.length === 0) return null;

    const messages = await this.prisma.caseMessage.findMany({
      where: { caseId: { in: cases.map((c) => c.id) } },
      orderBy: [{ caseId: 'asc' }, { createdAt: 'asc' }],
      select: { caseId: true, authorRole: true, createdAt: true },
    });
    if (messages.length === 0) return null;

    const gapsMs: number[] = [];
    let i = 0;
    while (i < messages.length) {
      const m = messages[i]!;
      if (m.authorRole === 'CLIENT') {
        // Walk forward in the same case looking for the next LIA reply.
        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j]!;
          if (next.caseId !== m.caseId) break;
          if (next.authorRole === 'LIA') {
            gapsMs.push(next.createdAt.getTime() - m.createdAt.getTime());
            break;
          }
        }
      }
      i++;
    }

    if (gapsMs.length === 0) return null;
    const avgMs = gapsMs.reduce((s, x) => s + x, 0) / gapsMs.length;
    return round1(avgMs / MS_PER_HOUR);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
