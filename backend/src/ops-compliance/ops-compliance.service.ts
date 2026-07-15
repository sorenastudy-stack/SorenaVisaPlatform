import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Phase B — OPS Compliance exceptions monitor.
//
// ONE check: the engagement contract. Surfaces ACTIVE cases whose contract state
// is a compliance exception — either the case advanced to a visa stage without a
// signed contract, or a contract envelope was started but never completed
// (sent/viewed/expired unsigned, or client-declined). Derived from existing
// Case + Contract rows — no writes, no new models, no migration.
//
// Deliberately NOT flagged: a fresh ADMISSION-stage case that simply has no
// contract yet — that's the normal pre-contract window, not an exception.
//
// Cross-case read is allowed ONLY for OPERATIONS + admin tier (the SEE_ALL
// tier), enforced at the controller — same gate as OPS Handoffs / Documents.

export type ComplianceReason =
  | 'contract_missing'   // visa-stage case, no contract row at all
  | 'contract_unsigned'  // visa-stage case, contract exists (e.g. DRAFT) but unsigned
  | 'contract_stalled'   // envelope SENT/VIEWED/EXPIRED, never signed
  | 'contract_declined'; // client declined the envelope

export interface ComplianceRow {
  caseId: string;
  clientName: string | null;
  stage: string;
  reason: ComplianceReason;
  since: string | null;
}
export interface NonCompliantResponse {
  rows: ComplianceRow[];
}

type ContractShape = {
  status: string;
  signedAt: Date | null;
  createdAt: Date;
  declinedAt: Date | null;
} | null;

@Injectable()
export class OpsComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async listNonCompliant(): Promise<NonCompliantResponse> {
    // ACTIVE = stage NOT IN (COMPLETED, WITHDRAWN). A case fails the contract
    // check when EITHER branch below matches. findMany dedupes to one row per
    // case even when both branches match.
    const cases = await this.prisma.case.findMany({
      where: {
        stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
        OR: [
          // (a) advanced to a visa stage without a signed contract
          //     (missing entirely, or present but signedAt still null).
          {
            stage: { in: ['VISA', 'INZ_SUBMITTED'] },
            OR: [
              { contract: { is: null } },
              { contract: { is: { signedAt: null } } },
            ],
          },
          // (b) an envelope was started but never completed — a stalled/declined
          //     exception at ANY active stage (incl. ADMISSION). DRAFT is
          //     intentionally excluded so a fresh unsent draft is not flagged.
          {
            contract: {
              is: {
                status: { in: ['SENT', 'VIEWED', 'DECLINED', 'EXPIRED'] },
                signedAt: null,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        stage: true,
        createdAt: true,
        contract: { select: { status: true, signedAt: true, createdAt: true, declinedAt: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });

    const rows: ComplianceRow[] = cases.map((c) => {
      const { reason, since } = this.classify(c.stage, c.createdAt, c.contract);
      return {
        caseId: c.id,
        clientName: c.lead?.contact?.fullName ?? null,
        stage: String(c.stage),
        reason,
        since: since ? since.toISOString() : null,
      };
    });

    // Oldest-first — the longest-waiting exceptions sit at the top. `since` is
    // always populated by classify(); the Infinity guard is defensive only.
    rows.sort((a, b) => {
      const at = a.since ? new Date(a.since).getTime() : Infinity;
      const bt = b.since ? new Date(b.since).getTime() : Infinity;
      return at - bt;
    });

    return { rows };
  }

  // One most-specific reason per case (precedence: declined > stalled >
  // unsigned > missing). Every case reaching here already matched the query
  // filter, so it IS non-compliant.
  private classify(
    stage: string,
    caseCreatedAt: Date,
    contract: ContractShape,
  ): { reason: ComplianceReason; since: Date } {
    if (!contract) {
      // Only reachable via branch (a): a visa-stage case with no contract.
      // No contract timestamp exists, so `since` is the case's own age — a fair
      // proxy for "how long this case has run without a contract".
      return { reason: 'contract_missing', since: caseCreatedAt };
    }
    if (contract.status === 'DECLINED') {
      return { reason: 'contract_declined', since: contract.declinedAt ?? contract.createdAt };
    }
    if (contract.status === 'SENT' || contract.status === 'VIEWED' || contract.status === 'EXPIRED') {
      return { reason: 'contract_stalled', since: contract.createdAt };
    }
    // DRAFT (or any other) contract present but unsigned on a visa-stage case.
    return { reason: 'contract_unsigned', since: contract.createdAt };
  }
}
