import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Phase 6 — OPS Handoffs exceptions monitor.
//
// Surfaces cases where a specialist slot is EMPTY *and* the case has already
// passed the lifecycle point where auto-assignment should have filled it — i.e.
// real staffing exceptions, not the normal pre-trigger empties. Signal is
// STATE-primary (the slot is null now, past its due event), enriched with the
// latest matching *_AUTO_ASSIGN_NO_CANDIDATES audit for the reason/timestamp.
//
// Per-slot "empty AND due" gates:
//   • LIA / ADMISSION (owner) / FINANCE → slot null AND Contract.signedAt != null
//   • PASTORAL (support)                → slot null AND Visa.outcome === 'APPROVED'
//   • CONSULTANT                        → per Ruling 1: NOT one row per case.
//       - a global banner when the CLIENT_CONSULTANT pool is empty, and
//       - per-case rows ONLY where a CONSULTANT_AUTO_ASSIGN_NO_CANDIDATES audit
//         exists (a genuine failed attempt; also suppresses legacy pre-slot cases).
// WITHDRAWN cases are excluded everywhere; visa-DECLINED is excluded by the
// APPROVED-only pastoral gate. No writes, no new models.

export type HandoffSlot = 'CONSULTANT' | 'LIA' | 'ADMISSION' | 'FINANCE' | 'PASTORAL';

interface MissingSlot {
  slot: HandoffSlot;
  dueSince: Date;
  reason: string | null;
  attemptAt: Date | null;
}
interface HandoffRow {
  caseId: string;
  clientName: string | null;
  stage: string;
  missingSlots: MissingSlot[];
  wrongRoleOwner: boolean;
  waitingSinceEarliest: Date | null;
}
export interface PendingHandoffsResponse {
  consultantPoolEmpty: boolean;
  unstaffedConsultantCount: number;
  rows: HandoffRow[];
}

// slot → the audit eventType that records "the auto-assigner found no candidate".
const AUDIT_EVENT: Record<HandoffSlot, string> = {
  CONSULTANT: 'CONSULTANT_AUTO_ASSIGN_NO_CANDIDATES',
  LIA:        'LIA_AUTO_ASSIGN_NO_CANDIDATES',
  ADMISSION:  'ADMISSION_AUTO_ASSIGN_NO_CANDIDATES',
  FINANCE:    'FINANCE_AUTO_ASSIGN_NO_CANDIDATES',
  PASTORAL:   'PASTORAL_AUTO_ASSIGN_NO_CANDIDATES',
};

@Injectable()
export class OpsHandoffsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPendingHandoffs(): Promise<PendingHandoffsResponse> {
    // ── Consultant banner (Ruling 1) ──
    const activeConsultants = await this.prisma.user.count({
      where: {
        role: 'CLIENT_CONSULTANT',
        isActive: true,
        OR: [{ staffActiveStatus: null }, { staffActiveStatus: { isActive: true } }],
      },
    });
    const consultantPoolEmpty = activeConsultants === 0;
    const unstaffedConsultantCount = await this.prisma.case.count({
      where: { consultantId: null, stage: { not: 'WITHDRAWN' } },
    });

    // Accumulate per-case signals.
    const byCase = new Map<string, HandoffRow>();
    const ensure = (caseId: string, stage: string, clientName: string | null): HandoffRow => {
      let row = byCase.get(caseId);
      if (!row) {
        row = { caseId, clientName, stage, missingSlots: [], wrongRoleOwner: false, waitingSinceEarliest: null };
        byCase.set(caseId, row);
      }
      return row;
    };
    const addMissing = (caseId: string, stage: string, clientName: string | null, slot: HandoffSlot, dueSince: Date) => {
      const row = ensure(caseId, stage, clientName);
      row.missingSlots.push({ slot, dueSince, reason: null, attemptAt: null });
    };

    // ── LIA / ADMISSION / FINANCE — contract signed + slot null ──
    const contractCases = await this.prisma.case.findMany({
      where: {
        stage: { not: 'WITHDRAWN' },
        contract: { signedAt: { not: null } },
        OR: [{ liaId: null }, { ownerId: null }, { financeId: null }],
      },
      select: {
        id: true, stage: true, liaId: true, ownerId: true, financeId: true,
        contract: { select: { signedAt: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    for (const c of contractCases) {
      const due = c.contract!.signedAt!;
      const name = c.lead?.contact?.fullName ?? null;
      if (!c.liaId) addMissing(c.id, String(c.stage), name, 'LIA', due);
      if (!c.ownerId) addMissing(c.id, String(c.stage), name, 'ADMISSION', due);
      if (!c.financeId) addMissing(c.id, String(c.stage), name, 'FINANCE', due);
    }

    // ── Wrong-role owner (Ruling 2) — contract signed, owner set but role != CONSULTANT ──
    const ownerCases = await this.prisma.case.findMany({
      where: {
        stage: { not: 'WITHDRAWN' },
        contract: { signedAt: { not: null } },
        ownerId: { not: null },
      },
      select: {
        id: true, stage: true,
        owner: { select: { role: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    for (const c of ownerCases) {
      if (c.owner && c.owner.role !== 'CONSULTANT') {
        ensure(c.id, String(c.stage), c.lead?.contact?.fullName ?? null).wrongRoleOwner = true;
      }
    }

    // ── PASTORAL — visa approved + support null ──
    const pastoralCases = await this.prisma.case.findMany({
      where: {
        stage: { not: 'WITHDRAWN' },
        supportId: null,
        visa: { outcome: 'APPROVED' },
      },
      select: {
        id: true, stage: true,
        visa: { select: { issuedAt: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    for (const c of pastoralCases) {
      addMissing(c.id, String(c.stage), c.lead?.contact?.fullName ?? null, 'PASTORAL', c.visa!.issuedAt);
    }

    // ── CONSULTANT — audit-gated per-case rows only (Ruling 1) ──
    const consultantAudits = await this.prisma.auditLog.findMany({
      where: { eventType: AUDIT_EVENT.CONSULTANT, entityType: 'CASE' },
      select: { entityId: true },
    });
    const consultantCaseIds = [...new Set(consultantAudits.map((a) => a.entityId).filter((x): x is string => !!x))];
    if (consultantCaseIds.length > 0) {
      const consultantCases = await this.prisma.case.findMany({
        where: { id: { in: consultantCaseIds }, consultantId: null, stage: { not: 'WITHDRAWN' } },
        select: {
          id: true, stage: true, createdAt: true,
          lead: { select: { contact: { select: { fullName: true } } } },
        },
      });
      for (const c of consultantCases) {
        addMissing(c.id, String(c.stage), c.lead?.contact?.fullName ?? null, 'CONSULTANT', c.createdAt);
      }
    }

    // ── Enrich each missing slot with the latest matching NO_CANDIDATES audit ──
    const caseIds = [...byCase.keys()];
    if (caseIds.length > 0) {
      const audits = await this.prisma.auditLog.findMany({
        where: { entityType: 'CASE', entityId: { in: caseIds }, eventType: { in: Object.values(AUDIT_EVENT) } },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, eventType: true, newValue: true, createdAt: true },
      });
      // latest per (caseId, eventType)
      const latest = new Map<string, { reason: string | null; attemptAt: Date }>();
      for (const a of audits) {
        const key = `${a.entityId}:${a.eventType}`;
        if (!latest.has(key)) {
          const reason = a.newValue && typeof a.newValue === 'object' && 'reason' in (a.newValue as any)
            ? String((a.newValue as any).reason)
            : null;
          latest.set(key, { reason, attemptAt: a.createdAt });
        }
      }
      for (const row of byCase.values()) {
        for (const m of row.missingSlots) {
          const hit = latest.get(`${row.caseId}:${AUDIT_EVENT[m.slot]}`);
          if (hit) { m.reason = hit.reason; m.attemptAt = hit.attemptAt; }
        }
      }
    }

    // waitingSinceEarliest = oldest dueSince across the case's missing slots.
    const rows = [...byCase.values()].map((row) => {
      const earliest = row.missingSlots.reduce<Date | null>(
        (min, m) => (min === null || m.dueSince.getTime() < min.getTime() ? m.dueSince : min),
        null,
      );
      return { ...row, waitingSinceEarliest: earliest };
    });

    // Drop rows that ended up with neither a missing slot nor a wrong-role owner
    // (shouldn't happen, but defensive), then oldest-waiting first.
    const filtered = rows.filter((r) => r.missingSlots.length > 0 || r.wrongRoleOwner);
    filtered.sort((a, b) => {
      const at = a.waitingSinceEarliest?.getTime() ?? Infinity;
      const bt = b.waitingSinceEarliest?.getTime() ?? Infinity;
      return at - bt;
    });

    return { consultantPoolEmpty, unstaffedConsultantCount, rows: filtered };
  }
}
