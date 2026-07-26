import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStage, ProviderType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-SLA — Owner-manageable, institution-type-varying stage deadlines.
//
// A case's deadline for its CURRENT stage = stageEnteredAt + slaDays, where slaDays
// comes from the SlaConfig row for (the case's institution type, its stage). ADMISSION
// counts WORKING days (skip weekends + NZ national public holidays); VISA /
// INZ_SUBMITTED count calendar days. A
// per-case stageDeadlineOverride wins when set. Terminal stages (COMPLETED/WITHDRAWN)
// have no deadline. Institution type is the case's accepted (or most-recent)
// application's provider.providerType, falling back to DEFAULT_INSTITUTION when unknown.
//
// Config is fully DB-driven — editing a row via /staff/settings/sla changes the
// calculation immediately, no code deploy. Only slaDays is editable; isWorkingDays is
// a property of the stage set at seed time.

const DEFAULT_INSTITUTION: ProviderType = 'UNIVERSITY';
// Last-resort fallback if a SlaConfig row is somehow missing (should not happen —
// the migration seeds all 3 institution types × 3 stages).
const CODE_FALLBACK: Record<string, { slaDays: number; isWorkingDays: boolean }> = {
  ADMISSION:     { slaDays: 25, isWorkingDays: true },
  VISA:          { slaDays: 30, isWorkingDays: false },
  INZ_SUBMITTED: { slaDays: 2,  isWorkingDays: false },
};
const TERMINAL: ReadonlySet<string> = new Set(['COMPLETED', 'WITHDRAWN']);

// NZ NATIONAL public holidays (observed/Mondayised dates, ISO yyyy-mm-dd, UTC).
// ADMISSION counts WORKING days and skips these in addition to weekends. National
// only — provincial anniversary days (e.g. Auckland/Wellington) are deliberately
// NOT included, since a case isn't tied to a single region. Static list, low
// upkeep: extend it every few years. Moving feasts (Easter, Matariki) and
// Mondayised weekend holidays are pre-resolved to their observed weekday date.
const NZ_PUBLIC_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', '2026-01-02', '2026-02-06', '2026-04-03', '2026-04-06',
  '2026-04-27', '2026-06-01', '2026-07-10', '2026-10-26', '2026-12-25', '2026-12-28',
  // 2027
  '2027-01-01', '2027-01-04', '2027-02-08', '2027-03-26', '2027-03-29',
  '2027-04-26', '2027-06-07', '2027-06-25', '2027-10-25', '2027-12-27', '2027-12-28',
  // 2028
  '2028-01-03', '2028-01-04', '2028-02-07', '2028-04-14', '2028-04-17',
  '2028-04-25', '2028-06-05', '2028-07-14', '2028-10-23', '2028-12-25', '2028-12-26',
  // 2029
  '2029-01-01', '2029-01-02', '2029-02-06', '2029-03-30', '2029-04-02',
  '2029-04-25', '2029-06-04', '2029-07-06', '2029-10-22', '2029-12-25', '2029-12-26',
  // 2030
  '2030-01-01', '2030-01-02', '2030-02-06', '2030-04-19', '2030-04-22',
  '2030-04-25', '2030-06-03', '2030-06-21', '2030-10-28', '2030-12-25', '2030-12-26',
]);

export interface SlaDeadline {
  deadline: Date | null;     // null for terminal stages / no config
  daysOverdue: number;       // 0 when not overdue or no deadline
  overdue: boolean;
  institutionType: ProviderType | null;
  overridden: boolean;
}

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Config management (/staff/settings/sla) ─────────────────────────────
  async listConfig() {
    return this.prisma.slaConfig.findMany({
      orderBy: [{ institutionType: 'asc' }, { stage: 'asc' }],
      select: { id: true, institutionType: true, stage: true, slaDays: true, isWorkingDays: true, updatedAt: true },
    });
  }

  async updateConfig(institutionType: ProviderType, stage: CaseStage, slaDays: number, actorId: string | null) {
    if (!Number.isInteger(slaDays) || slaDays < 0 || slaDays > 365) {
      throw new BadRequestException('slaDays must be a whole number between 0 and 365.');
    }
    const row = await this.prisma.slaConfig.findUnique({
      where: { uniq_institution_stage: { institutionType, stage } },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('No SLA config for that institution type + stage.');
    return this.prisma.slaConfig.update({
      where: { id: row.id },
      data: { slaDays, updatedById: actorId },
      select: { id: true, institutionType: true, stage: true, slaDays: true, isWorkingDays: true, updatedAt: true },
    });
  }

  // ── Institution-type resolution (batched) ───────────────────────────────
  // A case's institution = its accepted (offerAcceptedAt) application's provider,
  // else its most-recent application's provider. Returns null when the case has no
  // application yet (caller falls back to DEFAULT_INSTITUTION).
  async resolveInstitutionTypes(caseIds: string[]): Promise<Map<string, ProviderType | null>> {
    const map = new Map<string, ProviderType | null>();
    if (caseIds.length === 0) return map;
    const apps = await this.prisma.application.findMany({
      where: { caseId: { in: caseIds } },
      select: { caseId: true, offerAcceptedAt: true, createdAt: true, provider: { select: { providerType: true } } },
    });
    // Group + pick: accepted first (latest offerAcceptedAt), else latest createdAt.
    const byCase = new Map<string, typeof apps>();
    for (const a of apps) {
      const arr = byCase.get(a.caseId) ?? [];
      arr.push(a);
      byCase.set(a.caseId, arr);
    }
    for (const [caseId, list] of byCase) {
      const accepted = list.filter((a) => a.offerAcceptedAt).sort((x, y) => y.offerAcceptedAt!.getTime() - x.offerAcceptedAt!.getTime());
      const pick = accepted[0] ?? [...list].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
      map.set(caseId, pick?.provider?.providerType ?? null);
    }
    for (const id of caseIds) if (!map.has(id)) map.set(id, null);
    return map;
  }

  // ── Deadline computation ────────────────────────────────────────────────
  async computeForCases(
    cases: Array<{ id: string; stage: CaseStage | string; stageEnteredAt: Date | null; stageDeadlineOverride: Date | null; createdAt: Date }>,
    now: Date = new Date(),
  ): Promise<Map<string, SlaDeadline>> {
    const configs = await this.prisma.slaConfig.findMany({
      select: { institutionType: true, stage: true, slaDays: true, isWorkingDays: true },
    });
    const cfgKey = (t: ProviderType, s: string) => `${t}:${s}`;
    const cfgMap = new Map(configs.map((c) => [cfgKey(c.institutionType, String(c.stage)), c]));
    const instMap = await this.resolveInstitutionTypes(cases.map((c) => c.id));

    const out = new Map<string, SlaDeadline>();
    for (const c of cases) {
      const stage = String(c.stage);
      if (TERMINAL.has(stage)) {
        out.set(c.id, { deadline: null, daysOverdue: 0, overdue: false, institutionType: instMap.get(c.id) ?? null, overridden: false });
        continue;
      }
      const institutionType = (instMap.get(c.id) ?? DEFAULT_INSTITUTION) as ProviderType;
      const cfg = cfgMap.get(cfgKey(institutionType, stage))
        ?? cfgMap.get(cfgKey(DEFAULT_INSTITUTION, stage))
        ?? CODE_FALLBACK[stage];

      let deadline: Date;
      if (c.stageDeadlineOverride) {
        deadline = c.stageDeadlineOverride;
      } else {
        const base = c.stageEnteredAt ?? c.createdAt;
        deadline = cfg
          ? (cfg.isWorkingDays ? this.addWorkingDays(base, cfg.slaDays) : this.addDays(base, cfg.slaDays))
          : base;
      }
      const overdue = now.getTime() > deadline.getTime();
      const daysOverdue = overdue ? Math.floor((now.getTime() - deadline.getTime()) / 86_400_000) : 0;
      out.set(c.id, {
        deadline, daysOverdue, overdue,
        institutionType: instMap.get(c.id) ?? null,
        overridden: !!c.stageDeadlineOverride,
      });
    }
    return out;
  }

  // ── Owner/admin report: overdue cases grouped by Client Officer ─────────
  async getOverdueByOfficer(now: Date = new Date()) {
    const cases = await this.prisma.case.findMany({
      where: { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
      select: {
        id: true, stage: true, stageEnteredAt: true, stageDeadlineOverride: true, createdAt: true,
        consultant: { select: { id: true, name: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    const deadlines = await this.computeForCases(cases, now);

    const byOfficer = new Map<string, { officerId: string | null; officerName: string; cases: any[] }>();
    let totalOverdue = 0;
    for (const c of cases) {
      const d = deadlines.get(c.id)!;
      if (!d.overdue) continue;
      totalOverdue++;
      const officerId = c.consultant?.id ?? null;
      const key = officerId ?? '__unassigned__';
      const bucket = byOfficer.get(key) ?? { officerId, officerName: c.consultant?.name ?? 'Unassigned', cases: [] };
      bucket.cases.push({
        caseId: c.id,
        clientName: c.lead?.contact?.fullName ?? null,
        stage: String(c.stage),
        daysOverdue: d.daysOverdue,
        deadline: d.deadline,
      });
      byOfficer.set(key, bucket);
    }
    // Most-overdue officers first; within an officer, most-overdue case first.
    const officers = [...byOfficer.values()]
      .map((o) => ({ ...o, cases: o.cases.sort((a, b) => b.daysOverdue - a.daysOverdue) }))
      .sort((a, b) => b.cases.length - a.cases.length);
    return { officers, totalOverdue };
  }

  private addDays(d: Date, n: number): Date {
    return new Date(d.getTime() + n * 86_400_000);
  }
  // Add N working days, skipping Saturdays/Sundays AND NZ national public holidays.
  private addWorkingDays(start: Date, n: number): Date {
    const d = new Date(start.getTime());
    let added = 0;
    while (added < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      const dow = d.getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = NZ_PUBLIC_HOLIDAYS.has(d.toISOString().slice(0, 10));
      if (!isWeekend && !isHoliday) added++;
    }
    return d;
  }
}
