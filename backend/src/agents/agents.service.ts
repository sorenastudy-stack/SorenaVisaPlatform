import { Injectable } from '@nestjs/common';
import { AgentPayableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAgentAccess, AgentAccess } from './agent-access.helper';

// PR-AGENT-PORTAL phase 1 — what an agent sees about their own work.
//
// Read-only. Every query is filtered on the agent id the GATE resolved from
// the JWT, applied last and unconditionally. There is no parameter anywhere in
// this service that could widen it, because the failure being designed against
// is one agent seeing another's clients — which is not a bug you get to fix
// after somebody notices.

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The agent's own status. UNGATED — this is what a blocked agent reads.
   *
   * Returns their name and what is outstanding. No clients, no cases, no
   * counts of either: a blocked agent must not be able to infer how much
   * business is waiting behind the gate.
   */
  async me(userId: string | null | undefined): Promise<{
    name: string | null;
    allowed: boolean;
    verified: boolean;
    contracted: boolean;
    contractIsManualOverride: boolean;
    blockedReasons: string[];
  }> {
    const a: AgentAccess = await resolveAgentAccess(this.prisma, userId);
    return {
      name: a.agentName,
      allowed: a.allowed,
      verified: a.verified,
      contracted: a.contracted,
      contractIsManualOverride: a.contractIsManualOverride,
      blockedReasons: a.blockedReasons,
    };
  }

  /**
   * The clients this agent introduced.
   *
   * Stage, offer and enrolment come from the same chains the accounting
   * dashboard reads, so the agent's view of a client cannot disagree with
   * Sorena's. Contact details are deliberately absent — the agent introduced
   * this person and knows who they are; what they need from here is progress.
   */
  async leads(agentId: string) {
    const leads = await this.prisma.lead.findMany({
      where: { attributedAgentId: agentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leadStatus: true,
        createdAt: true,
        contact: { select: { fullName: true } },
        cases: {
          select: {
            id: true,
            stage: true,
            admissionApplications: {
              select: {
                programmeChoices: {
                  select: {
                    firstClassAttendedAt: true,
                    offerRecords: { select: { offerType: true, decision: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    return leads.map((l) => {
      const choices = l.cases.flatMap((c) =>
        c.admissionApplications.flatMap((a) => a.programmeChoices),
      );
      const offers = choices.flatMap((c) => c.offerRecords);
      return {
        id: l.id,
        studentName: l.contact?.fullName ?? null,
        leadStatus: l.leadStatus,
        caseStage: l.cases[0]?.stage ?? null,
        // "Did they get an offer" is a fact about the offer records, not about
        // how far the case travelled — a case can advance without one.
        hasOffer: offers.length > 0,
        offerAccepted: offers.some((o) => o.decision === 'ACCEPTED'),
        // Started classes: the same field the commission trigger runs on, so
        // the agent and Finance are reading one truth.
        startedClasses: choices.some((c) => !!c.firstClassAttendedAt),
        introducedAt: l.createdAt,
      };
    });
  }

  /**
   * What this agent is owed and has been paid.
   *
   * Amounts in MINOR UNITS, matching every other money endpoint. Rejected
   * payables are shown — an agent is entitled to know a share was refused and
   * why — but they never count toward a total.
   */
  async payables(agentId: string) {
    const rows = await this.prisma.agentPayable.findMany({
      where: { agentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        commission: {
          select: {
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

    const items = rows.map((r) => ({
      id: r.id,
      studentName:
        r.commission?.programmeChoice?.admissionApplication?.case?.lead?.contact?.fullName ?? null,
      providerName: r.commission?.provider?.name ?? null,
      programmeName: r.commission?.programme?.name ?? null,
      amountMinorUnits: Math.round(Number(r.amount) * 100),
      currency: r.currency,
      ratePercent: r.ratePercent,
      status: r.status,
      paidAt: r.paidAt,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
    }));

    // Per currency, never blended — the rule this codebase applies everywhere
    // money is totalled, because combining currencies needs a rate nobody
    // locked at the time.
    const owed = new Map<string, number>();
    const paid = new Map<string, number>();
    for (const r of rows) {
      if (r.status === AgentPayableStatus.REJECTED) continue;
      const minor = Math.round(Number(r.amount) * 100);
      const bucket = r.status === AgentPayableStatus.PAID ? paid : owed;
      bucket.set(r.currency, (bucket.get(r.currency) ?? 0) + minor);
    }

    return {
      items,
      totals: {
        owedByCurrency: Object.fromEntries(owed),
        paidByCurrency: Object.fromEntries(paid),
      },
    };
  }
}
