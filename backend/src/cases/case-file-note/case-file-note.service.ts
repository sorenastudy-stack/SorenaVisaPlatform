import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { canAccessCaseFileNote } from '../case-access.helper';

// PR-LIA-12 — Case File Note: the chronological master log per case.
//
// Aggregates events from every PR-LIA model that has touched the case.
// Read-only by design (the only writes are the two audit rows: one on
// view, one on export). Decrypts encrypted body fields server-side
// because the per-case access check has already gated who can see
// the data. If decryption fails on any single row the substitute
// "[DECRYPTION ERROR]" goes into the body — never crash the timeline.
//
// Source tables (data lineage — see handover §4):
//   * Case                       — CASE_OPENED, applicant overview
//   * AuditLog (entityType=CASE) — LIA_AUTO_ASSIGNED, LIA_MANUAL_REASSIGNED,
//                                  LIA_RISK_OVERRIDDEN, LIA_HARD_STOP_CLEARED,
//                                  INZ_SUBMITTED / EDITED / REVERTED,
//                                  VISA_ISSUED / DECLINED / REVERTED,
//                                  CASE_OFFICER_LINKED / UNLINKED
//   * LegalNote                  — LEGAL_NOTE_ADDED + DECISION_RECORDED
//   * CaseMessage                — CLIENT_MESSAGE (LIA + client direction)
//   * AdmissionDocument          — DOCUMENT_UPLOADED (via Case → AdmissionApp)
//   * VisaSupportingDocument     — DOCUMENT_UPLOADED (via Case → AdmissionApp
//                                  → VisaApplication)
//   * CaseDocumentReview         — DOCUMENT_REVIEWED
//   * VisaSupportTicket          — TICKET_OPENED (via the VisaCase resolve chain)
//   * VisaSupportTicketMessage   — TICKET_MESSAGE
//   * VisaMeeting                — MEETING_HELD (status=COMPLETED, by clientId)
//   * CaseOfficerLinkage         — OFFICER_LINKED (current state row)

export type TimelineEvent =
  | { type: 'CASE_OPENED'; at: string; actorName: string | null }
  | { type: 'LIA_ASSIGNED'; at: string; actorName: string | null; details: { liaName: string; reason?: string } }
  | { type: 'LIA_REASSIGNED'; at: string; actorName: string | null; details: { fromLia: string | null; toLia: string | null; reason: string } }
  | { type: 'STAGE_CHANGED'; at: string; actorName: string | null; details: { from: string; to: string } }
  | { type: 'RISK_OVERRIDDEN'; at: string; actorName: string | null; details: { from: string; to: string; reason: string } }
  | { type: 'HARD_STOP_CLEARED'; at: string; actorName: string | null; details: { reason: string } }
  | { type: 'LEGAL_NOTE_ADDED'; at: string; actorName: string | null; details: { body: string } }
  | { type: 'DECISION_RECORDED'; at: string; actorName: string | null; details: { decision: string; reason: string } }
  | { type: 'CLIENT_MESSAGE'; at: string; actorName: string; details: { body: string; kind: string; isFromClient: boolean } }
  | { type: 'DOCUMENT_UPLOADED'; at: string; actorName: string | null; details: { fileName: string; source: string; docType: string | null } }
  | { type: 'DOCUMENT_REVIEWED'; at: string; actorName: string | null; details: { fileName: string; status: string; reason: string } }
  | { type: 'TICKET_OPENED'; at: string; actorName: string; details: { subject: string; department: string; ticketId: string } }
  | { type: 'TICKET_MESSAGE'; at: string; actorName: string; details: { ticketId: string; body: string; isInternal: boolean } }
  | { type: 'MEETING_HELD'; at: string; actorName: string | null; details: { title: string; transcriptAvailable: boolean; notes: string | null } }
  | { type: 'INZ_SUBMITTED'; at: string; actorName: string | null; details: { applicationNumber: string; notes: string | null } }
  | { type: 'INZ_SUBMISSION_EDITED'; at: string; actorName: string | null; details: { changedFields: string[] } }
  | { type: 'INZ_SUBMISSION_REVERTED'; at: string; actorName: string | null; details: { reason: string } }
  | { type: 'VISA_ISSUED'; at: string; actorName: string | null; details: { startDate: string; endDate: string } }
  | { type: 'VISA_DECLINED'; at: string; actorName: string | null; details: { declineReason: string } }
  | { type: 'VISA_RECORD_REVERTED'; at: string; actorName: string | null; details: { reason: string } }
  | { type: 'OFFICER_LINKED'; at: string; actorName: string | null; details: { officerName: string; note: string | null; outcomeSnapshot: string | null } }
  | { type: 'OFFICER_UNLINKED'; at: string; actorName: string | null };

export interface CaseFileNoteTimeline {
  generatedAt: string;
  case: {
    id: string;
    stage: string;
    riskLevel: string;
    createdAt: string;
    updatedAt: string;
    applicant: {
      fullName: string | null;
      email: string | null;
      phone: string | null;
      countryOfResidence: string | null;
    };
    assignedLia: { id: string; name: string } | null;
    assignedOwner: { id: string; name: string } | null;
    visa: { outcome: string; visaStartDate: string | null; visaEndDate: string | null } | null;
    inz: { inzApplicationNumber: string; inzSubmittedAt: string } | null;
  };
  events: TimelineEvent[];
  counts: {
    messages: number;
    documents: number;
    decisions: number;
    meetings: number;
    officerLinkages: number;
    totalEvents: number;
  };
}

interface Viewer {
  userId: string;
  name: string | null;
  role: string;
}

@Injectable()
export class CaseFileNoteService {
  private readonly logger = new Logger(CaseFileNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── Timeline (JSON) ───────────────────────────────────────────────────

  async getTimeline(caseId: string, viewer: Viewer): Promise<CaseFileNoteTimeline> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        lead: { include: { contact: true } },
        owner: { select: { id: true, name: true } },
        lia: { select: { id: true, name: true } },
        visa: { select: { outcome: true, visaStartDate: true, visaEndDate: true } },
      },
    });
    if (!c) throw new NotFoundException('Case not found');
    if (!canAccessCaseFileNote(c, viewer)) {
      throw new ForbiddenException('You are not allocated to this case.');
    }

    const events: TimelineEvent[] = [];

    // 1. CASE_OPENED — synthetic from the Case row's createdAt
    events.push({
      type: 'CASE_OPENED',
      at: c.createdAt.toISOString(),
      actorName: null, // intake source is not always a User
    });

    // 2. Audit-sourced events
    const auditRows = await this.prisma.auditLog.findMany({
      where: { entityType: 'CASE', entityId: caseId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
    for (const a of auditRows) {
      const evt = this.mapAuditRow(a);
      if (evt) events.push(evt);
    }

    // 3. LegalNotes — notes + decisions
    const notes = await this.prisma.legalNote.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });
    for (const n of notes) {
      const body = this.tryDecryptBytes(n.bodyEncrypted as unknown as Buffer);
      if (n.decision) {
        const reason = n.decisionReasonEncrypted
          ? this.tryDecryptBytes(n.decisionReasonEncrypted as unknown as Buffer)
          : '';
        events.push({
          type: 'DECISION_RECORDED',
          at: n.createdAt.toISOString(),
          actorName: n.author?.name ?? null,
          details: { decision: String(n.decision), reason },
        });
      } else {
        events.push({
          type: 'LEGAL_NOTE_ADDED',
          at: n.createdAt.toISOString(),
          actorName: n.author?.name ?? null,
          details: { body },
        });
      }
    }

    // 4. CaseMessages
    const msgs = await this.prisma.caseMessage.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });
    for (const m of msgs) {
      const body = this.tryDecryptBytes(m.bodyEncrypted as unknown as Buffer);
      events.push({
        type: 'CLIENT_MESSAGE',
        at: m.createdAt.toISOString(),
        actorName: m.author?.name ?? (m.authorRole === 'CLIENT' ? 'Client' : 'LIA'),
        details: {
          body,
          kind: String(m.kind),
          isFromClient: m.authorRole === 'CLIENT',
        },
      });
    }

    // 5. Documents — admission + visa supporting
    const admissionApps = await this.prisma.admissionApplication.findMany({
      where: { caseId },
      select: { id: true },
    });
    const admissionAppIds = admissionApps.map((a) => a.id);
    if (admissionAppIds.length > 0) {
      const admissionDocs = await this.prisma.admissionDocument.findMany({
        where: { admissionApplicationId: { in: admissionAppIds } },
        orderBy: { uploadedAt: 'asc' },
      });
      for (const d of admissionDocs) {
        events.push({
          type: 'DOCUMENT_UPLOADED',
          at: d.uploadedAt.toISOString(),
          actorName: null, // admission docs are client-uploaded; no User attribution at upload
          details: {
            fileName: d.fileName,
            source: 'ADMISSION',
            docType: String(d.documentType),
          },
        });
      }

      const visaApps = await this.prisma.visaApplication.findMany({
        where: { applicationId: { in: admissionAppIds } },
        select: { id: true },
      });
      const visaAppIds = visaApps.map((v) => v.id);
      if (visaAppIds.length > 0) {
        // PR-FILES-2: file metadata + uploadedAt live on the children
        // now. Fan out to one DOCUMENT_UPLOADED event per child file
        // (multiple files per parent — each upload is its own event).
        const visaDocs = await this.prisma.visaSupportingDocument.findMany({
          where: { visaApplicationId: { in: visaAppIds } },
          select: {
            documentType: true,
            files: {
              orderBy: { uploadedAt: 'asc' },
              select: { originalFilename: true, uploadedAt: true },
            },
          },
        });
        for (const d of visaDocs) {
          for (const f of d.files) {
            events.push({
              type: 'DOCUMENT_UPLOADED',
              at: f.uploadedAt.toISOString(),
              actorName: null,
              details: {
                fileName: f.originalFilename,
                source: 'VISA_SUPPORTING',
                docType: String(d.documentType),
              },
            });
          }
        }
      }
    }

    // 6. CaseDocumentReview rows
    const reviews = await this.prisma.caseDocumentReview.findMany({
      where: { caseId },
      orderBy: { reviewedAt: 'asc' },
      include: { reviewedBy: { select: { id: true, name: true } } },
    });
    for (const r of reviews) {
      const reason = this.tryDecryptBytes(r.reasonEncrypted as unknown as Buffer);
      events.push({
        type: 'DOCUMENT_REVIEWED',
        at: r.reviewedAt.toISOString(),
        actorName: r.reviewedBy?.name ?? null,
        details: {
          // sourceRowId is the document row id; the human filename
          // lives on the source table — best-effort lookup avoided to
          // keep the query count bounded. The audit-feed surface
          // already shows just the source + status.
          fileName: r.sourceRowId,
          status: String(r.status),
          reason,
        },
      });
    }

    // 7. Tickets + meetings — via the VisaCase resolve chain
    const visaCaseId = await this.resolveVisaCaseId(caseId);
    if (visaCaseId) {
      const tickets = await this.prisma.visaSupportTicket.findMany({
        where: { caseId: visaCaseId },
        orderBy: { createdAt: 'asc' },
        include: { client: { select: { id: true, name: true } } },
      });
      for (const t of tickets) {
        const subject = this.tryDecryptBytes(t.subjectEncrypted as unknown as Buffer);
        events.push({
          type: 'TICKET_OPENED',
          at: t.createdAt.toISOString(),
          actorName: t.client?.name ?? 'Client',
          details: {
            subject,
            department: String(t.department),
            ticketId: t.id,
          },
        });

        const ticketMsgs = await this.prisma.visaSupportTicketMessage.findMany({
          where: { ticketId: t.id },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true } } },
        });
        for (const tm of ticketMsgs) {
          if (tm.authorRole === 'SYSTEM') continue;
          const body = this.tryDecryptBytes(tm.bodyEncrypted as unknown as Buffer);
          events.push({
            type: 'TICKET_MESSAGE',
            at: tm.createdAt.toISOString(),
            actorName: tm.author?.name ?? String(tm.authorRole),
            details: {
              ticketId: t.id,
              body,
              isInternal: tm.isInternalNote,
            },
          });
        }
      }

      // Meetings — by VisaCase.clientId, status=COMPLETED
      const vc = await this.prisma.visaCase.findUnique({
        where: { id: visaCaseId },
        select: { clientId: true },
      });
      if (vc) {
        const meetings = await this.prisma.visaMeeting.findMany({
          where: {
            studentId: vc.clientId,
            status: 'COMPLETED',
          },
          orderBy: { scheduledAt: 'asc' },
          include: { transcriptFile: { select: { id: true } } },
        });
        for (const m of meetings) {
          // Notes is base64-encrypted; best-effort decrypt, null on failure.
          let notes: string | null = null;
          if (m.transcriptNotes && m.transcriptNotes.length > 0) {
            try {
              notes = this.crypto.decrypt(Buffer.from(m.transcriptNotes, 'base64'));
            } catch {
              notes = null;
            }
          }
          events.push({
            type: 'MEETING_HELD',
            at: m.scheduledAt.toISOString(),
            actorName: null,
            details: {
              title: `${m.meetingType} meeting`,
              transcriptAvailable: !!m.transcriptFile,
              notes,
            },
          });
        }
      }
    }

    // 8. Sort chronologically; deterministic sub-order by type for ties
    events.sort((a, b) => {
      const ta = new Date(a.at).getTime();
      const tb = new Date(b.at).getTime();
      if (ta !== tb) return ta - tb;
      return a.type.localeCompare(b.type);
    });

    // 9. Counts
    const counts = {
      messages: events.filter((e) => e.type === 'CLIENT_MESSAGE').length,
      documents: events.filter((e) => e.type === 'DOCUMENT_UPLOADED').length,
      decisions: events.filter((e) => e.type === 'DECISION_RECORDED').length,
      meetings: events.filter((e) => e.type === 'MEETING_HELD').length,
      officerLinkages: events.filter((e) => e.type === 'OFFICER_LINKED').length,
      totalEvents: events.length,
    };

    // 10. Audit the view
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: viewer.userId,
          action: 'READ',
          eventType: 'CASE_FILE_NOTE_VIEWED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { caseId } as Prisma.InputJsonValue,
          actorNameSnapshot: viewer.name ?? null,
          actorRoleSnapshot: viewer.role ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to audit CASE_FILE_NOTE_VIEWED for ${caseId}: ${err?.message ?? err}`,
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      case: {
        id: c.id,
        stage: String(c.stage),
        riskLevel: String(c.riskLevel),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        applicant: {
          fullName: c.lead?.contact?.fullName ?? null,
          email: c.lead?.contact?.email ?? null,
          phone: c.lead?.contact?.phone ?? null,
          countryOfResidence: c.lead?.contact?.countryOfResidence ?? null,
        },
        assignedLia: c.lia ? { id: c.lia.id, name: c.lia.name } : null,
        assignedOwner: c.owner ? { id: c.owner.id, name: c.owner.name } : null,
        visa: c.visa
          ? {
              outcome: String(c.visa.outcome),
              visaStartDate: c.visa.visaStartDate?.toISOString() ?? null,
              visaEndDate: c.visa.visaEndDate?.toISOString() ?? null,
            }
          : null,
        inz: c.inzApplicationNumber && c.inzSubmittedAt
          ? {
              inzApplicationNumber: c.inzApplicationNumber,
              inzSubmittedAt: c.inzSubmittedAt.toISOString(),
            }
          : null,
      },
      events,
      counts,
    };
  }

  // ─── Markdown export ───────────────────────────────────────────────────

  async exportAsMarkdown(caseId: string, viewer: Viewer): Promise<string> {
    const tl = await this.getTimeline(caseId, viewer);
    await this.auditExport(caseId, 'MD', viewer);

    const lines: string[] = [];
    lines.push(`# Case File Note — ${tl.case.applicant.fullName ?? 'Unknown applicant'}`);
    lines.push('');
    lines.push(`**Case ID:** \`${tl.case.id}\``);
    lines.push(`**Stage:** ${tl.case.stage} · **Risk:** ${tl.case.riskLevel}`);
    lines.push(`**Generated at:** ${this.fmtTs(tl.generatedAt)} by ${viewer.name ?? viewer.userId} (${viewer.role})`);
    lines.push('');

    // Overview
    lines.push('## Overview');
    lines.push('');
    lines.push(`- **Applicant:** ${tl.case.applicant.fullName ?? '—'}`);
    lines.push(`- **Email:** ${tl.case.applicant.email ?? '—'}`);
    lines.push(`- **Phone:** ${tl.case.applicant.phone ?? '—'}`);
    lines.push(`- **Country of residence:** ${tl.case.applicant.countryOfResidence ?? '—'}`);
    lines.push(`- **Assigned LIA:** ${tl.case.assignedLia?.name ?? '—'}`);
    lines.push(`- **Assigned owner (CRM):** ${tl.case.assignedOwner?.name ?? '—'}`);
    if (tl.case.inz) {
      lines.push(`- **INZ reference:** \`${tl.case.inz.inzApplicationNumber}\` (submitted ${this.fmtDate(tl.case.inz.inzSubmittedAt)})`);
    }
    if (tl.case.visa) {
      const dates = tl.case.visa.visaStartDate && tl.case.visa.visaEndDate
        ? ` — valid ${this.fmtDate(tl.case.visa.visaStartDate)} → ${this.fmtDate(tl.case.visa.visaEndDate)}`
        : '';
      lines.push(`- **Visa outcome:** ${tl.case.visa.outcome}${dates}`);
    }
    lines.push('');

    // Timeline
    lines.push('## Timeline');
    lines.push('');
    if (tl.events.length === 0) {
      lines.push('*No events recorded.*');
    } else {
      for (const e of tl.events) {
        lines.push(this.renderEventMarkdown(e));
      }
    }
    lines.push('');

    // Summary counts
    lines.push('## Summary counts');
    lines.push('');
    lines.push(`- **Messages:** ${tl.counts.messages}`);
    lines.push(`- **Documents:** ${tl.counts.documents}`);
    lines.push(`- **Decisions:** ${tl.counts.decisions}`);
    lines.push(`- **Meetings:** ${tl.counts.meetings}`);
    lines.push(`- **Officer linkages:** ${tl.counts.officerLinkages}`);
    lines.push(`- **Total events:** ${tl.counts.totalEvents}`);
    lines.push('');

    lines.push('---');
    lines.push(`*Generated at ${this.fmtTs(tl.generatedAt)} by ${viewer.name ?? viewer.userId}*`);

    return lines.join('\n');
  }

  // ─── Text export ───────────────────────────────────────────────────────

  async exportAsText(caseId: string, viewer: Viewer): Promise<string> {
    const tl = await this.getTimeline(caseId, viewer);
    await this.auditExport(caseId, 'TXT', viewer);

    const bar = '='.repeat(72);
    const lines: string[] = [];
    lines.push(bar);
    lines.push(`CASE FILE NOTE — ${tl.case.applicant.fullName ?? 'Unknown applicant'}`);
    lines.push(`Case ID: ${tl.case.id}`);
    lines.push(`Stage: ${tl.case.stage}  |  Risk: ${tl.case.riskLevel}`);
    lines.push(`Generated at: ${this.fmtTs(tl.generatedAt)} by ${viewer.name ?? viewer.userId} (${viewer.role})`);
    lines.push(bar);
    lines.push('');

    // Overview
    lines.push('OVERVIEW');
    lines.push('-'.repeat(72));
    lines.push(`  Applicant:           ${tl.case.applicant.fullName ?? '-'}`);
    lines.push(`  Email:               ${tl.case.applicant.email ?? '-'}`);
    lines.push(`  Phone:               ${tl.case.applicant.phone ?? '-'}`);
    lines.push(`  Country of residence:${tl.case.applicant.countryOfResidence ? ' ' + tl.case.applicant.countryOfResidence : ' -'}`);
    lines.push(`  Assigned LIA:        ${tl.case.assignedLia?.name ?? '-'}`);
    lines.push(`  Assigned owner:      ${tl.case.assignedOwner?.name ?? '-'}`);
    if (tl.case.inz) {
      lines.push(`  INZ reference:       ${tl.case.inz.inzApplicationNumber} (submitted ${this.fmtDate(tl.case.inz.inzSubmittedAt)})`);
    }
    if (tl.case.visa) {
      const dates = tl.case.visa.visaStartDate && tl.case.visa.visaEndDate
        ? ` (${this.fmtDate(tl.case.visa.visaStartDate)} -> ${this.fmtDate(tl.case.visa.visaEndDate)})`
        : '';
      lines.push(`  Visa outcome:        ${tl.case.visa.outcome}${dates}`);
    }
    lines.push('');

    // Timeline
    lines.push('TIMELINE');
    lines.push('-'.repeat(72));
    if (tl.events.length === 0) {
      lines.push('  (no events recorded)');
    } else {
      for (const e of tl.events) {
        for (const line of this.renderEventText(e)) {
          lines.push(line);
        }
      }
    }
    lines.push('');

    // Summary
    lines.push('SUMMARY COUNTS');
    lines.push('-'.repeat(72));
    lines.push(`  Messages:         ${tl.counts.messages}`);
    lines.push(`  Documents:        ${tl.counts.documents}`);
    lines.push(`  Decisions:        ${tl.counts.decisions}`);
    lines.push(`  Meetings:         ${tl.counts.meetings}`);
    lines.push(`  Officer linkages: ${tl.counts.officerLinkages}`);
    lines.push(`  Total events:     ${tl.counts.totalEvents}`);
    lines.push('');

    lines.push(bar);
    lines.push(`Generated at ${this.fmtTs(tl.generatedAt)} by ${viewer.name ?? viewer.userId}`);
    lines.push(bar);

    return lines.join('\n');
  }

  // ─── Audit-row mapper ──────────────────────────────────────────────────

  private mapAuditRow(
    a: {
      eventType: string | null;
      action: string;
      createdAt: Date;
      oldValue: unknown;
      newValue: unknown;
      actorNameSnapshot: string | null;
      user: { id: string; name: string } | null;
    },
  ): TimelineEvent | null {
    const at = a.createdAt.toISOString();
    const actorName = a.user?.name ?? a.actorNameSnapshot ?? null;
    const newV = (a.newValue ?? {}) as Record<string, any>;
    const oldV = (a.oldValue ?? {}) as Record<string, any>;

    switch (a.eventType) {
      case 'LIA_AUTO_ASSIGNED':
        return {
          type: 'LIA_ASSIGNED',
          at,
          actorName,
          details: { liaName: typeof newV.liaName === 'string' ? newV.liaName : '—' },
        };
      case 'LIA_AUTO_ASSIGN_NO_CANDIDATES':
        return null; // a non-event; skip
      case 'LIA_MANUAL_REASSIGNED':
        return {
          type: 'LIA_REASSIGNED',
          at,
          actorName,
          details: {
            fromLia: typeof oldV.liaName === 'string' ? oldV.liaName : null,
            toLia: typeof newV.liaName === 'string' ? newV.liaName : null,
            reason: typeof newV.reasonLength === 'number'
              ? `(reason encrypted, ${newV.reasonLength} chars)`
              : '',
          },
        };
      case 'LIA_RISK_OVERRIDDEN':
        return {
          type: 'RISK_OVERRIDDEN',
          at,
          actorName,
          details: {
            from: typeof oldV.riskLevel === 'string' ? oldV.riskLevel : '—',
            to: typeof newV.riskLevel === 'string' ? newV.riskLevel : '—',
            reason: typeof newV.reasonLength === 'number'
              ? `(reason captured in paired LegalNote)`
              : '',
          },
        };
      case 'LIA_HARD_STOP_CLEARED':
        return {
          type: 'HARD_STOP_CLEARED',
          at,
          actorName,
          details: {
            reason: typeof newV.reasonLength === 'number'
              ? `(justification captured in paired LegalNote)`
              : '',
          },
        };
      case 'INZ_SUBMITTED':
        return {
          type: 'INZ_SUBMITTED',
          at,
          actorName,
          details: {
            applicationNumber: typeof newV.inzApplicationNumber === 'string'
              ? newV.inzApplicationNumber
              : '—',
            notes: null,
          },
        };
      case 'INZ_SUBMISSION_EDITED':
        return {
          type: 'INZ_SUBMISSION_EDITED',
          at,
          actorName,
          details: {
            changedFields: Array.isArray(newV)
              ? []
              : Object.keys(newV).filter((k) => k !== 'reasonEncryptedBase64'),
          },
        };
      case 'INZ_SUBMISSION_REVERTED':
        return {
          type: 'INZ_SUBMISSION_REVERTED',
          at,
          actorName,
          details: { reason: '(reason encrypted in audit row)' },
        };
      case 'VISA_ISSUED':
        return {
          type: 'VISA_ISSUED',
          at,
          actorName,
          details: {
            startDate: typeof newV.visaStartDate === 'string' ? newV.visaStartDate.slice(0, 10) : '—',
            endDate: typeof newV.visaEndDate === 'string' ? newV.visaEndDate.slice(0, 10) : '—',
          },
        };
      case 'VISA_DECLINED':
        return {
          type: 'VISA_DECLINED',
          at,
          actorName,
          details: { declineReason: '(reason encrypted on Visa row — see linked decline record)' },
        };
      case 'VISA_RECORD_EDITED':
        return null; // Not in the union; skip (we surface via LegalNote etc.)
      case 'VISA_RECORD_REVERTED':
        return {
          type: 'VISA_RECORD_REVERTED',
          at,
          actorName,
          details: { reason: '(reason encrypted in audit row)' },
        };
      case 'CASE_OFFICER_LINKED':
        return {
          type: 'OFFICER_LINKED',
          at,
          actorName,
          details: {
            officerName: typeof newV.officerName === 'string' ? newV.officerName : '—',
            note: null,
            outcomeSnapshot: typeof newV.linkedOutcome === 'string' ? newV.linkedOutcome : null,
          },
        };
      case 'CASE_OFFICER_UNLINKED':
        return { type: 'OFFICER_UNLINKED', at, actorName };
      default:
        return null;
    }
  }

  // ─── Render helpers ────────────────────────────────────────────────────

  private renderEventMarkdown(e: TimelineEvent): string {
    const ts = this.fmtTs(e.at);
    const actor = e.actorName ?? 'system';
    const head = `- **[${ts}]** *${this.eventLabel(e.type)}* — by *${actor}*`;
    const detail = this.renderEventDetail(e);
    if (!detail) return head;
    // Long bodies render as quoted block on the following line.
    if (this.isLongBody(detail)) {
      return `${head}\n\n> ${detail.replace(/\n/g, '\n> ')}\n`;
    }
    return `${head} — ${detail}`;
  }

  private renderEventText(e: TimelineEvent): string[] {
    const ts = this.fmtTs(e.at);
    const actor = e.actorName ?? 'system';
    const head = `  [${ts}] ${e.type} — by ${actor}`;
    const detail = this.renderEventDetail(e);
    if (!detail) return [head];
    if (this.isLongBody(detail)) {
      const lines = [head];
      for (const line of detail.split('\n')) {
        lines.push(`    ${line}`);
      }
      return lines;
    }
    return [`${head} — ${detail}`];
  }

  private renderEventDetail(e: TimelineEvent): string {
    switch (e.type) {
      case 'CASE_OPENED':
        return 'Case opened';
      case 'LIA_ASSIGNED':
        return `${e.details.liaName} assigned`;
      case 'LIA_REASSIGNED':
        if (e.details.fromLia && e.details.toLia) return `${e.details.fromLia} → ${e.details.toLia}`;
        if (e.details.toLia) return `assigned to ${e.details.toLia}`;
        if (e.details.fromLia) return `cleared (was ${e.details.fromLia})`;
        return 'LIA assignment changed';
      case 'STAGE_CHANGED':
        return `${e.details.from} → ${e.details.to}`;
      case 'RISK_OVERRIDDEN':
        return `${e.details.from} → ${e.details.to} ${e.details.reason}`.trim();
      case 'HARD_STOP_CLEARED':
        return e.details.reason || 'hard stop cleared';
      case 'LEGAL_NOTE_ADDED':
        return e.details.body;
      case 'DECISION_RECORDED':
        return `${e.details.decision}\n${e.details.reason}`;
      case 'CLIENT_MESSAGE':
        return `${e.details.isFromClient ? 'Client' : 'LIA'} (${e.details.kind}): ${e.details.body}`;
      case 'DOCUMENT_UPLOADED':
        return `${e.details.fileName} (${e.details.source}${e.details.docType ? ' / ' + e.details.docType : ''})`;
      case 'DOCUMENT_REVIEWED':
        return `${e.details.status} — ${e.details.reason}`;
      case 'TICKET_OPENED':
        return `${e.details.department}: ${e.details.subject}`;
      case 'TICKET_MESSAGE':
        return `${e.details.isInternal ? '[internal] ' : ''}${e.details.body}`;
      case 'MEETING_HELD':
        return `${e.details.title}${e.details.transcriptAvailable ? ' (transcript available)' : ''}${e.details.notes ? '\n' + e.details.notes : ''}`;
      case 'INZ_SUBMITTED':
        return `application #${e.details.applicationNumber}`;
      case 'INZ_SUBMISSION_EDITED':
        return e.details.changedFields.length > 0
          ? `changed: ${e.details.changedFields.join(', ')}`
          : 'edited';
      case 'INZ_SUBMISSION_REVERTED':
        return e.details.reason;
      case 'VISA_ISSUED':
        return `valid ${e.details.startDate} → ${e.details.endDate}`;
      case 'VISA_DECLINED':
        return e.details.declineReason;
      case 'VISA_RECORD_REVERTED':
        return e.details.reason;
      case 'OFFICER_LINKED':
        return `${e.details.officerName}${e.details.outcomeSnapshot ? ' (snapshot: ' + e.details.outcomeSnapshot + ')' : ''}${e.details.note ? '\n' + e.details.note : ''}`;
      case 'OFFICER_UNLINKED':
        return 'officer link cleared';
    }
  }

  private isLongBody(s: string): boolean {
    return s.length > 80 || s.includes('\n');
  }

  private eventLabel(type: TimelineEvent['type']): string {
    // Humanise SOME_EVENT_TYPE → "Some event type" for Markdown headings.
    return type
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private tryDecryptBytes(buf: Buffer): string {
    try {
      return this.crypto.decrypt(buf);
    } catch (err: any) {
      this.logger.error(`Decryption failed: ${err?.message ?? err}`);
      return '[DECRYPTION ERROR]';
    }
  }

  private fmtTs(iso: string): string {
    // YYYY-MM-DD HH:MM in UTC for deterministic exports.
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  }

  private fmtDate(iso: string): string {
    return iso.slice(0, 10);
  }

  private async auditExport(
    caseId: string,
    format: 'MD' | 'TXT',
    viewer: Viewer,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: viewer.userId,
          action: 'READ',
          eventType: 'CASE_FILE_NOTE_EXPORTED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { caseId, format } as Prisma.InputJsonValue,
          actorNameSnapshot: viewer.name ?? null,
          actorRoleSnapshot: viewer.role ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to audit CASE_FILE_NOTE_EXPORTED for ${caseId}: ${err?.message ?? err}`,
      );
    }
  }

  // Mirrors PR-LIA-7/8/10: Case → AdmissionApplication → VisaApplication → VisaCase.
  private async resolveVisaCaseId(caseId: string): Promise<string | null> {
    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!admission) return null;
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
      select: { id: true },
    });
    if (!visa) return null;
    const vc = await this.prisma.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
      select: { id: true },
    });
    return vc?.id ?? null;
  }
}
