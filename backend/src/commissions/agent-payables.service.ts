import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgentPayableStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';

// PR-AGENT-PAYABLES — what Sorena owes the agents who introduce clients:
// derived (phase 1), then approved and released (phase 2).
//
// The payable is DERIVED, never asserted. There is no "submit" step because
// there is nobody to submit it: the amount falls out of a commission Sorena has
// already earned, so a human claiming it would only be retyping arithmetic.
//
// What a human does decide is whether it is really owed, and whether to pay it
// — and those are deliberately two people. Finance moves PENDING → APPROVED;
// the Owner moves APPROVED → PAID, and cannot do both on the same row.

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

/** Who agrees a share is owed. Finance decides debts. */
export const PAYABLE_APPROVE_ROLES = ['FINANCE', 'SUPER_ADMIN', 'OWNER'];

/** Who releases the money. Deliberately a different question from approving. */
export const PAYABLE_RELEASE_ROLES = ['OWNER'];

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
   * Idempotent, and safe to call on every read: a partial unique index allows
   * only one non-rejected payable per commission, so a second run creates
   * nothing. A REJECTED row does not block a fresh derivation — that is the
   * whole reason the constraint is partial rather than outright. It runs on read rather than from a cron because
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
        // Never seen before. A commission that has ANY payable — including a
        // rejected one — is not derived again.
        //
        // This is deliberately narrower than the constraint underneath it. The
        // partial unique index permits a replacement for a rejected payable, so
        // raising one later needs no migration; what it must not do is happen
        // BY ITSELF. Automatic re-derivation would put the refused row back in
        // Finance's queue within a second of them refusing it, which makes a
        // rejection unable to mean anything. Re-raising is a decision somebody
        // takes, and the action for it is not built yet.
        agentPayables: { none: {} },
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

    // Each agent's own rate, read once rather than per commission.
    // PR-AGENT-PORTAL phase 0: the rate used to be one company-wide constant.
    // It is now whatever the Owner agreed with that agent, falling back to the
    // constant when nothing was agreed. Only the SOURCE of the number changes —
    // it is still snapshotted onto the payable below and never recomputed, so
    // an agent already told what they are owed is unaffected by a later change.
    const agentIds = [
      ...new Set(
        candidates
          .map((c) => c.programmeChoice?.admissionApplication?.case?.lead?.attributedAgentId)
          .filter((id): id is string => !!id),
      ),
    ];
    const rateByAgent = new Map<string, number>();
    if (agentIds.length) {
      const agents = await this.prisma.affiliateAgent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, commissionRatePercent: true },
      });
      for (const a of agents) {
        // A null rate means "no override agreed"; 0 is a real answer and is
        // kept, which is why this tests for null rather than falsiness.
        rateByAgent.set(a.id, a.commissionRatePercent ?? AGENT_COMMISSION_RATE_PERCENT);
      }
    }

    let created = 0;
    for (const c of candidates) {
      const agentId = c.programmeChoice?.admissionApplication?.case?.lead?.attributedAgentId;
      const basis = AgentPayablesService.basis(c);
      // No agent, or nothing to take a share of — skip rather than write a zero.
      if (!agentId || basis == null) continue;

      const rate = rateByAgent.get(agentId) ?? AGENT_COMMISSION_RATE_PERCENT;
      const amount = Math.round(basis * (rate / 100) * 100) / 100;
      try {
        await this.prisma.agentPayable.create({
          data: {
            agentId,
            commissionId: c.id,
            amount: new Prisma.Decimal(amount),
            currency: c.currency,
            ratePercent: rate,
          },
        });
        created += 1;
      } catch (e: any) {
        // Two readers racing on the same commission. The partial unique index
        // did its job; the live row exists either way.
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
      // A refused share is not a balance. Left in, REJECTED rows would fall
      // through to "owed" and the dashboard would report money the company has
      // decided it does not owe.
      where: { status: { not: AgentPayableStatus.REJECTED } },
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

  // ── Phase 2: approve, reject, release ──────────────────────────────────────

  /**
   * Write the decision to the audit log.
   *
   * The amount and currency go in the payload deliberately. The refund
   * precedent records that an approval was executed but never what moved, so
   * reconstructing how much left the company means joining back through rows
   * that may since have changed. A money event should be legible on its own.
   *
   * Name and role are snapshotted for the same reason they are on the payable:
   * a staff row can be hard-deleted, and an audit trail that turns into a bare
   * id is not a trail.
   */
  private async writeAudit(
    eventType: string,
    payable: { id: string; amount: Prisma.Decimal | number; currency: string; agentId: string },
    actor: PayableActor,
    extra: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id ?? null,
        action: eventType,
        eventType,
        entityType: 'AGENT_PAYABLE',
        entityId: payable.id,
        newValue: {
          amount: Number(payable.amount),
          currency: payable.currency,
          agentId: payable.agentId,
          ...extra,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });
  }

  /**
   * The actor, with a name that actually exists.
   *
   * The JWT carries sub, email, role and secondaryRoles — and no name — so
   * `req.user.name` is undefined and a snapshot taken from it would record
   * null on every decision. The point of the snapshot is that it survives the
   * staff row being deleted, which a null does not, so the name is read once
   * from the database at decision time.
   */
  private async resolveActor(actor: PayableActor): Promise<PayableActor> {
    if (actor.name || !actor.id) return actor;
    const u = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true, email: true },
    });
    return { ...actor, name: u?.name ?? u?.email ?? null };
  }

  /** One payable, or a 404 that does not confirm what it is hiding. */
  private async mustFind(id: string) {
    const row = await this.prisma.agentPayable.findUnique({
      where: { id },
      include: { agent: { select: { fullName: true } } },
    });
    if (!row) throw new NotFoundException('That payable is not on record.');
    return row;
  }

  /**
   * Move a payable between states, or fail.
   *
   * A conditional UPDATE, never read-then-write. The status is part of the
   * WHERE clause, so two callers racing on the same row cannot both succeed:
   * the first changes the status, the second matches nothing and gets a count
   * of zero. The owner-approval queue reads, checks, then writes, and is saved
   * only by Stripe's idempotency key — a payout has no such backstop, so the
   * database has to be the thing that says no.
   */
  private async transition(
    id: string,
    from: AgentPayableStatus,
    data: Prisma.AgentPayableUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await this.prisma.agentPayable.updateMany({
      where: { id, status: from },
      data,
    });
    return count === 1;
  }

  /** Payables waiting on Finance. */
  async listPending(actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_APPROVE_ROLES)) {
      throw new ForbiddenException('You are not allowed to decide agent payables.');
    }
    await this.syncFromCommissions().catch((e) =>
      this.logger.error(`[agent-payables] sync failed: ${e?.message ?? e}`),
    );
    return this.listByStatus(AgentPayableStatus.PENDING);
  }

  /** Payables Finance has agreed, waiting on the Owner to release. */
  async listAwaitingRelease(actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_VIEW_ROLES)) {
      throw new ForbiddenException('You are not allowed to view agent payables.');
    }
    return this.listByStatus(AgentPayableStatus.APPROVED);
  }

  /**
   * How many are waiting on the Owner.
   *
   * Its own method rather than `listAwaitingRelease().length` because the badge
   * is read on every page load and does not need the rows — and because a
   * payable, unlike a refund request, never expires. Nothing eventually clears
   * an unnoticed one, so the count is the only thing that will say so.
   */
  async awaitingReleaseCount(actor: PayableActor): Promise<{ count: number }> {
    if (!hasRole(actor, ...PAYABLE_VIEW_ROLES)) return { count: 0 };
    return { count: await this.prisma.agentPayable.count({ where: { status: AgentPayableStatus.APPROVED } }) };
  }

  private async listByStatus(status: AgentPayableStatus) {
    const rows = await this.prisma.agentPayable.findMany({
      where: { status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        agent: { select: { id: true, fullName: true, status: true } },
        commission: {
          select: {
            id: true, currency: true, status: true,
            provider: { select: { name: true } },
            programme: { select: { name: true } },
            programmeChoice: {
              select: {
                admissionApplication: {
                  select: { case: { select: { lead: { select: { contact: { select: { fullName: true } } } } } } },
                },
              },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentName: r.agent?.fullName ?? null,
      studentName:
        r.commission?.programmeChoice?.admissionApplication?.case?.lead?.contact?.fullName ?? null,
      providerName: r.commission?.provider?.name ?? null,
      programmeName: r.commission?.programme?.name ?? null,
      amountMinorUnits: Math.round(Number(r.amount) * 100),
      currency: r.currency,
      ratePercent: r.ratePercent,
      status: r.status,
      approvedById: r.approvedById,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt,
      createdAt: r.createdAt,
    }));
  }

  /** Finance agrees the share is owed. */
  async approve(id: string, actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_APPROVE_ROLES)) {
      throw new ForbiddenException('You are not allowed to approve agent payables.');
    }
    if (!actor.id) throw new ForbiddenException('An approval must be attributable to a person.');
    const who = await this.resolveActor(actor);

    const row = await this.mustFind(id);
    if (row.status !== AgentPayableStatus.PENDING) {
      await this.writeAudit('AGENT_PAYABLE_APPROVE_REFUSED', row, actor, {
        refusedBecause: `status was ${row.status}, not PENDING`,
      });
      throw new BadRequestException(`This payable is already ${row.status.toLowerCase()}.`);
    }

    const moved = await this.transition(id, AgentPayableStatus.PENDING, {
      status: AgentPayableStatus.APPROVED,
      approvedById: who.id!,
      approvedByName: who.name ?? null,
      approvedAt: new Date(),
    });
    if (!moved) {
      // Somebody else decided it between the read and the write.
      await this.writeAudit('AGENT_PAYABLE_APPROVE_REFUSED', row, actor, {
        refusedBecause: 'lost a race — the payable was decided by someone else first',
      });
      throw new BadRequestException('That payable was just decided by someone else.');
    }

    await this.writeAudit('AGENT_PAYABLE_APPROVED', row, who, { agentName: row.agent?.fullName ?? null });
    return this.mustFind(id);
  }

  /** Finance refuses the share. Terminal, and the reason is not optional. */
  async reject(id: string, reason: string, actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_APPROVE_ROLES)) {
      throw new ForbiddenException('You are not allowed to decide agent payables.');
    }
    if (!actor.id) throw new ForbiddenException('A decision must be attributable to a person.');
    const who = await this.resolveActor(actor);

    const clean = (reason ?? '').trim();
    if (clean.length < 3) {
      throw new BadRequestException('Say why this is not owed — the reason is kept for reconciliation.');
    }

    const row = await this.mustFind(id);
    if (row.status !== AgentPayableStatus.PENDING) {
      await this.writeAudit('AGENT_PAYABLE_REJECT_REFUSED', row, actor, {
        refusedBecause: `status was ${row.status}, not PENDING`,
      });
      throw new BadRequestException(`This payable is already ${row.status.toLowerCase()}.`);
    }

    const moved = await this.transition(id, AgentPayableStatus.PENDING, {
      status: AgentPayableStatus.REJECTED,
      rejectedById: who.id!,
      rejectedByName: who.name ?? null,
      rejectedAt: new Date(),
      rejectionReason: clean,
    });
    if (!moved) {
      await this.writeAudit('AGENT_PAYABLE_REJECT_REFUSED', row, actor, {
        refusedBecause: 'lost a race — the payable was decided by someone else first',
      });
      throw new BadRequestException('That payable was just decided by someone else.');
    }

    await this.writeAudit('AGENT_PAYABLE_REJECTED', row, who, { reason: clean });
    return this.mustFind(id);
  }

  /**
   * The Owner releases the money.
   *
   * The rule this whole phase exists for: whoever approved the debt cannot be
   * the one who pays it. Without this line the two states are paperwork — one
   * person with the right role walks a payable from PENDING to PAID alone, and
   * nothing on the way out disagrees.
   */
  async release(id: string, actor: PayableActor) {
    if (!hasRole(actor, ...PAYABLE_RELEASE_ROLES)) {
      throw new ForbiddenException('Only the Owner can release an agent payout.');
    }
    if (!actor.id) throw new ForbiddenException('A payout must be attributable to a person.');
    const who = await this.resolveActor(actor);

    const row = await this.mustFind(id);
    if (row.status !== AgentPayableStatus.APPROVED) {
      await this.writeAudit('AGENT_PAYABLE_RELEASE_REFUSED', row, actor, {
        refusedBecause: `status was ${row.status}, not APPROVED`,
      });
      throw new BadRequestException(`This payable is ${row.status.toLowerCase()}, not approved for release.`);
    }

    if (row.approvedById && row.approvedById === actor.id) {
      // Recorded, not merely refused: an attempt by one person to complete both
      // halves is exactly the event this control exists to catch, and it must
      // not be invisible.
      await this.writeAudit('AGENT_PAYABLE_RELEASE_REFUSED', row, actor, {
        refusedBecause: 'same person approved and attempted to release',
        approvedById: row.approvedById,
      });
      throw new ForbiddenException(
        'You approved this payable, so somebody else must release it — two people, always.',
      );
    }

    const moved = await this.transition(id, AgentPayableStatus.APPROVED, {
      status: AgentPayableStatus.PAID,
      paidById: who.id!,
      paidByName: who.name ?? null,
      paidAt: new Date(),
    });
    if (!moved) {
      await this.writeAudit('AGENT_PAYABLE_RELEASE_REFUSED', row, actor, {
        refusedBecause: 'lost a race — the payable was released by someone else first',
      });
      throw new BadRequestException('That payable was just released by someone else.');
    }

    await this.writeAudit('AGENT_PAYABLE_PAID', row, who, {
      approvedById: row.approvedById,
      approvedByName: row.approvedByName,
      agentName: row.agent?.fullName ?? null,
    });
    return this.mustFind(id);
  }
}
