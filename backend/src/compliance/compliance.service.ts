import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-COMPLIANCE — Owner-dashboard compliance data.
//
// Composes existing signals into two Owner-facing reads:
//   • listFlaggedCases()      — every lead/case currently carrying a hard stop
//     (HS1-HS6) or a red flag (liaEscalationRequired), with a per-case
//     LIA-routing-compliance verdict.
//   • listOverrideAuditLog()  — the override-relevant slice of the AuditLog,
//     pre-filtered so the Owner doesn't have to (the full browser is /admin/audit).
//
// The LIA-routing-compliance check (one line):
//   A lead that required LIA escalation (liaEscalationRequired) is routing-
//   compliant only if — for any engagement contract sent on its case — an APPROVED
//   LIA legal decision was recorded BEFORE that contract was sent. A flagged lead
//   with no contract yet is compliant (pending review); a contract sent with no
//   prior APPROVED decision is a BREACH.

export type FlagStatus =
  | 'HARD_STOP'          // hard stop active, not cleared
  | 'AWAITING_LIA'       // red-flagged, no APPROVED LIA decision yet
  | 'APPROVED_UNCLEARED'; // red-flagged but an APPROVED decision exists (flag not yet cleared — edge)

export type RoutingCompliance = 'COMPLIANT' | 'BREACH' | 'NOT_APPLICABLE';

export interface FlaggedCaseRow {
  leadId: string;
  clientId: string | null;
  clientName: string | null;
  caseId: string | null;
  caseStage: string | null;
  hardStop: boolean;
  hardStopReason: string | null;
  redFlag: boolean;             // liaEscalationRequired
  liaApproved: boolean;         // an APPROVED LIA consultation decision exists
  contractSent: boolean;        // an engagement contract row exists on the case
  status: FlagStatus;
  routingCompliance: RoutingCompliance;
  routingDetail: string;        // human explanation for the verdict
  flaggedSince: Date;           // lead.createdAt (proxy for how long it's been flagged)
}

export interface OverrideAuditRow {
  id: string;
  createdAt: Date;
  eventType: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorName: string;
  actorRole: string | null;
}

// Override / high-sensitivity event types surfaced on the Compliance page. Extra
// entries are harmless (they simply match no rows); the full log is /admin/audit.
export const OVERRIDE_EVENT_TYPES: readonly string[] = [
  'LIA_HARD_STOP_CLEARED',
  'LIA_LEAD_GATE_CLEARED',
  'LEGAL_DECISION_RECORDED',
  'LEGAL_NOTE_ADDED',
  'CONSULTANT_MANUAL_REASSIGNED',
  'FINANCE_MANUAL_REASSIGNED',
  'SUPPORT_MANUAL_REASSIGNED',
  'LIA_MANUAL_REASSIGNED',
  'PLATFORM_SETTING_UPDATED',
  'BANK_DETAILS_UPDATED',
  'CHANGE_STAFF_SECONDARY_ROLES',
  'STAFF_HARD_DELETED',
  'PAYMENT_VERIFICATION_REJECTED',
  'RECEIPT_REJECTED_BY_FINANCE',
  'INZ_SUBMISSION_REVERTED',
  'VISA_RECORD_REVERTED',
  'OWNER_APPROVAL_EXPIRED',
  'DOCUMENT_ACCESS_DENIED',
];

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  // Every lead currently carrying a hard stop or a red flag, with its LIA-routing
  // verdict. Approved-and-cleared leads leave this list automatically (Phase B
  // clears liaEscalationRequired on APPROVED), so what remains is "needs attention".
  async listFlaggedCases(): Promise<FlaggedCaseRow[]> {
    const leads = await this.prisma.lead.findMany({
      where: { OR: [{ hardStopFlag: true }, { liaEscalationRequired: true }] },
      orderBy: { createdAt: 'asc' }, // longest-flagged first
      select: {
        id: true,
        clientId: true,
        createdAt: true,
        hardStopFlag: true,
        hardStopReason: true,
        liaEscalationRequired: true,
        contact: { select: { fullName: true } },
        // Most recent case (a lead has 0..1 in practice).
        cases: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            stage: true,
            contract: { select: { createdAt: true } },
          },
        },
        // The APPROVED LIA verdict, if any (Phase A). decidedAt drives the
        // "approved BEFORE contract sent" ordering check.
        consultations: {
          where: { type: 'LIA', decision: 'APPROVED' },
          orderBy: { decidedAt: 'desc' },
          take: 1,
          select: { decidedAt: true },
        },
      },
    });

    return leads.map((l) => {
      const kase = l.cases[0] ?? null;
      const approvedAt = l.consultations[0]?.decidedAt ?? null;
      const liaApproved = approvedAt !== null;
      const contractSentAt = kase?.contract?.createdAt ?? null;
      const contractSent = contractSentAt !== null;

      const status: FlagStatus = l.hardStopFlag
        ? 'HARD_STOP'
        : liaApproved
          ? 'APPROVED_UNCLEARED'
          : 'AWAITING_LIA';

      // LIA-routing-compliance verdict — only meaningful for the red-flag path.
      let routingCompliance: RoutingCompliance;
      let routingDetail: string;
      if (!l.liaEscalationRequired) {
        routingCompliance = 'NOT_APPLICABLE';
        routingDetail = 'Hard stop only — no LIA-escalation routing to check.';
      } else if (!contractSent) {
        routingCompliance = 'COMPLIANT';
        routingDetail = 'No engagement contract sent yet — awaiting LIA review.';
      } else if (approvedAt && contractSentAt && approvedAt <= contractSentAt) {
        routingCompliance = 'COMPLIANT';
        routingDetail = 'LIA approved before the contract was sent.';
      } else {
        routingCompliance = 'BREACH';
        routingDetail = 'A contract was sent without a prior APPROVED LIA decision.';
      }

      return {
        leadId: l.id,
        clientId: l.clientId,
        clientName: l.contact?.fullName ?? null,
        caseId: kase?.id ?? null,
        caseStage: kase ? String(kase.stage) : null,
        hardStop: l.hardStopFlag,
        hardStopReason: l.hardStopReason,
        redFlag: l.liaEscalationRequired,
        liaApproved,
        contractSent,
        status,
        routingCompliance,
        routingDetail,
        flaggedSince: l.createdAt,
      };
    });
  }

  // The override-relevant slice of the AuditLog — safe summaries only (no raw
  // old/new values; those live behind /admin/audit/:id). Newest first.
  async listOverrideAuditLog(limit = 50): Promise<OverrideAuditRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { eventType: { in: [...OVERRIDE_EVENT_TYPES] } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        createdAt: true,
        eventType: true,
        action: true,
        entityType: true,
        entityId: true,
        actorNameSnapshot: true,
        actorRoleSnapshot: true,
        user: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      eventType: r.eventType,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorName: r.actorNameSnapshot ?? r.user?.name ?? '(system)',
      actorRole: r.actorRoleSnapshot ?? null,
    }));
  }
}
