import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AgentPayableStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';

// PR-AGENT-PAYABLES (phase 1) — what Sorena owes the agents who introduce
// clients, derived and visible. Approving and paying come next; nothing here
// moves money or changes a status.
//
// The payable is DERIVED, never asserted. There is no "submit" step because
// there is nobody to submit it: the amount falls out of a commission Sorena has
// already earned, so a human claiming it would only be retyping arithmetic.

/**
 * The share of a provider commission an introducing agent receives.
 *
 * One rate for every agent. A per-agent override is a plausible extension — the
 * rate is snapshotted onto each payable precisely so introducing one later
 * cannot restate what an agent has already been told they are owed — but it is
 * NOT built, and nothing reads a per-agent field today.
 *
 * Named and exported rather than written inline so changing it is one edit in
 * one findable place.
 */
export const AGENT_COMMISSION_RATE_PERCENT = 10;

/** Who may see the money. Same tier as the commission ledger. */
export const PAYABLE_VIEW_ROLES = ['OWNER', 'SUPER_ADMIN', 'FINANCE'];

export interface PayableActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
}

@Injectable()
export class AgentPayablesService {
  private readonly logger = new Logger(AgentPayablesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The amount a commission is worth, in its own currency.
   *
   * Actual before estimated: once a provider has told us what they are really
   * paying, an agent's share follows the real number rather than the guess.
   * A commission with neither cannot produce a payable — a share of an unknown
   * amount is not a figure anyone should be shown.
   */
  private static basis(c: { actualAmountNZD: number | null; estimatedAmountNZD: number | null }): number | null {
    const v = c.actualAmountNZD ?? c.estimatedAmountNZD;
    return v != null && v > 0 ? v : null;
  }

  /**
   * Create payables that should exist and do not yet.
   *
   * Idempotent, and safe to call on every read: `commissionId` is unique, so a
   * second run creates nothing. It runs on read rather than from a cron because
   * a nightly job would leave a window where a commission exists and its
   * payable does not, and would need backfilling whenever it missed.
   *
   * Only ever INSERTS. An existing payable is never recalculated — its amount
   * and rate are what the agent was told, and a later change to the company
   * rate must not silently rewrite that.
   */
  async syncFromCommissions(): Promise<number> {
    const candidates = await this.prisma.commission.findMany({
      where: {
        status: { not: 'CANCELLED' },
        agentPayable: null,
        programmeChoice: {
          admissionApplication: { case: { lead: { attributedAgentId: { not: null } } } },
        },
      },
      select: {
        id: true, currency: true, actualAmountNZD: true, estimatedAmountNZD: true,
        programmeChoice: {
          select: {
            admissionApplication: {
              select: { case: { select: { lead: { select: { attributedAgentId: true } } } } },
            },
          },
        },
      },
    });

    let created = 0;
    for (const c of candidates) {
      const agentId = c.programmeChoice?.admissionApplication?.case?.lead?.attributedAgentId;
      const basis = AgentPayablesService.basis(c);
      // No agent, or nothing to take a share of — skip rather than write a zero.
      if (!agentId || basis == null) continue;

      const amount = Math.round(basis * (AGENT_COMMISSION_RATE_PERCENT / 100) * 100) / 100;
      try {
        await this.prisma.agentPayable.create({
          data: {
            agentId,
            commissionId: c.id,
            amount: new Prisma.Decimal(amount),
            currency: c.currency,
            ratePercent: AGENT_COMMISSION_RATE_PERCENT,
          },
        });
        created += 1;
      } catch (e: any) {
        // Two readers racing on the same commission. The unique constraint did
        // its job; the row exists either way.
        if (e?.code !== 'P2002') throw e;
      }
    }
    return created;
  }

  /**
   * The ledger.
   *
   * Read-only in this phase. Amounts are returned in MINOR UNITS, matching the
   * accounting endpoint, so no caller has to ask which it is holding.
   */
  async list(actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_VIEW_ROLES)) {
      throw new ForbiddenException('You are not allowed to view agent payables.');
    }

    // Best-effort: a derivation failure must not take the page down with it.
    await this.syncFromCommissions().catch((e) =>
      this.logger.error(`[agent-payables] sync failed: ${e?.message ?? e}`),
    );

    const rows = await this.prisma.agentPayable.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        agent: { select: { id: true, fullName: true, status: true } },
        commission: {
          select: {
            id: true, currency: true, status: true,
            provider: { select: { name: true } },
            programme: { select: { name: true } },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentName: r.agent?.fullName ?? null,
      agentStatus: r.agent?.status ?? null,
      commissionId: r.commissionId,
      providerName: r.commission?.provider?.name ?? null,
      programmeName: r.commission?.programme?.name ?? null,
      commissionStatus: r.commission?.status ?? null,
      amountMinorUnits: Math.round(Number(r.amount) * 100),
      currency: r.currency,
      ratePercent: r.ratePercent,
      status: r.status,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt,
      paidByName: r.paidByName,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Per-agent totals, for the dashboard's two agent cards.
   *
   * `owed` is everything not yet paid — pending and approved together, because
   * from the agent's side both mean "not in my account". `paid` is what has
   * actually gone out.
   */
  async summary(actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_VIEW_ROLES)) {
      throw new ForbiddenException('You are not allowed to view agent payables.');
    }
    await this.syncFromCommissions().catch(() => undefined);

    const rows = await this.prisma.agentPayable.findMany({
      include: { agent: { select: { id: true, fullName: true } } },
    });

    const byAgent = new Map<string, {
      agentId: string; agentName: string | null; currency: string;
      owedMinorUnits: number; paidMinorUnits: number; count: number;
    }>();

    for (const r of rows) {
      // Currency is part of the key: an agent owed in two currencies has two
      // balances, and adding them would need a rate nobody locked.
      const key = `${r.agentId}::${r.currency}`;
      const minor = Math.round(Number(r.amount) * 100);
      const e = byAgent.get(key) ?? {
        agentId: r.agentId, agentName: r.agent?.fullName ?? null,
        currency: r.currency, owedMinorUnits: 0, paidMinorUnits: 0, count: 0,
      };
      if (r.status === AgentPayableStatus.PAID) e.paidMinorUnits += minor;
      else e.owedMinorUnits += minor;
      e.count += 1;
      byAgent.set(key, e);
    }

    return [...byAgent.values()].sort((a, b) => b.owedMinorUnits - a.owedMinorUnits);
  }
}
