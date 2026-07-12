import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseDocumentReviewSource, CaseDocumentReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

// Student-facing document review-status read (item 1).
//
// A STUDENT/AGENT sees the review verdict on their OWN uploaded documents
// (ADMISSION + VISA_SUPPORTING sources only). Owner-scoped strictly by the
// caller's JWT userId — there is NO client-supplied case id, so cross-client
// access is structurally impossible; a missing profile/lead/case → 404.
//
// Reason safety (server-side, non-negotiable):
//   • The rejection reason is decrypted ONLY inside the REJECTED branch.
//     APPROVED / UNREVIEWED rows never touch crypto.decrypt and carry
//     reason=null — an internal note for a passed/pending doc never leaves
//     the server.
//   • Even for REJECTED, the decrypted note is passed through a conservative
//     denylist (it was authored as an INTERNAL note): empty, very short,
//     ID-like/digit-heavy, @-mentions, or a marker word → generic fallback.
//   • Reviewer identity (reviewedById / reviewedBy name) is never SELECTED
//     and never returned.

export type StudentDocumentStatus = 'UNREVIEWED' | 'APPROVED' | 'REJECTED';

export interface StudentDocumentStatusRow {
  source: 'ADMISSION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  docType: string;
  status: StudentDocumentStatus;
  reviewedAt: Date | null;
  reason: string | null; // populated ONLY when status === 'REJECTED'
}

// Tunable: client-facing message shown whenever a rejection reason is empty
// or fails the "looks internal" check below.
const GENERIC_REJECTION_FALLBACK =
  "Please re-upload this document, or message your consultant if you're unsure.";

// Tunable: case-insensitive substrings that mark a reason as internal-only.
const INTERNAL_MARKERS = ['internal', 'escalat', 'fraud', 'suspect', 'flag', 'todo'] as const;

// A reason shorter than this reads as shorthand, not a client-facing sentence.
const MIN_CLIENT_REASON_LENGTH = 15;

@Injectable()
export class StudentDocumentStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // Owner resolution — copy of AdmissionService.resolveContactAndCase, trimmed
  // to just the caseId. userId comes from the verified JWT; nothing is client
  // supplied. Each miss 404s with a non-leaky message, matching the other
  // /students/me/* reads.
  private async resolveOwnCaseId(userId: string): Promise<string> {
    const contact = await this.prisma.contact.findUnique({ where: { userId } });
    if (!contact) throw new NotFoundException('Student profile not found');

    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) throw new NotFoundException('No lead found for this student');

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!caseRecord) throw new NotFoundException('No case found for this student');

    return caseRecord.id;
  }

  async listOwnDocumentStatuses(userId: string): Promise<StudentDocumentStatusRow[]> {
    const caseId = await this.resolveOwnCaseId(userId);

    // 1. ADMISSION source rows — Case → AdmissionApplication → AdmissionDocument.
    const admissions = await this.prisma.admissionApplication.findMany({
      where: { caseId },
      select: { id: true, documents: { select: { id: true, documentType: true } } },
    });

    // 2. VISA_SUPPORTING source rows — Case → AdmissionApplication →
    //    VisaApplication → VisaSupportingDocument (parent row per document type).
    const admissionIds = admissions.map((a) => a.id);
    const visaApps = admissionIds.length
      ? await this.prisma.visaApplication.findMany({
          where: { applicationId: { in: admissionIds } },
          select: {
            supportingDocuments: { select: { id: true, documentType: true } },
          },
        })
      : [];

    // 3. Existing verdicts for this case, both student-visible sources. Note we
    //    deliberately do NOT select reviewedById / reviewedBy — reviewer
    //    identity must never reach the student.
    const reviews = await this.prisma.caseDocumentReview.findMany({
      where: {
        caseId,
        source: { in: ['ADMISSION', 'VISA_SUPPORTING'] as CaseDocumentReviewSource[] },
      },
      select: { source: true, sourceRowId: true, status: true, reviewedAt: true, reasonEncrypted: true },
    });
    const reviewByKey = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) reviewByKey.set(this.key(r.source, r.sourceRowId), r);

    const rows: StudentDocumentStatusRow[] = [];

    for (const adm of admissions) {
      for (const d of adm.documents) {
        rows.push(this.shape('ADMISSION', d.id, String(d.documentType), reviewByKey.get(this.key('ADMISSION', d.id))));
      }
    }
    for (const va of visaApps) {
      for (const d of va.supportingDocuments) {
        rows.push(
          this.shape('VISA_SUPPORTING', d.id, String(d.documentType), reviewByKey.get(this.key('VISA_SUPPORTING', d.id))),
        );
      }
    }

    return rows;
  }

  private key(source: CaseDocumentReviewSource, sourceRowId: string): string {
    return `${source}:${sourceRowId}`;
  }

  private shape(
    source: 'ADMISSION' | 'VISA_SUPPORTING',
    sourceRowId: string,
    docType: string,
    review: { status: CaseDocumentReviewStatus; reviewedAt: Date; reasonEncrypted: Uint8Array | Buffer } | undefined,
  ): StudentDocumentStatusRow {
    // No review row → UNREVIEWED. No decrypt, no reason.
    if (!review) {
      return { source, sourceRowId, docType, status: 'UNREVIEWED', reviewedAt: null, reason: null };
    }
    // Reviewed but not rejected → APPROVED. Still no decrypt, no reason.
    if (review.status !== 'REJECTED') {
      return { source, sourceRowId, docType, status: 'APPROVED', reviewedAt: review.reviewedAt, reason: null };
    }
    // REJECTED — and ONLY here — decrypt + apply the safe fallback.
    return {
      source,
      sourceRowId,
      docType,
      status: 'REJECTED',
      reviewedAt: review.reviewedAt,
      reason: this.safeRejectionReason(review.reasonEncrypted),
    };
  }

  // Decrypt (only ever called for REJECTED rows) then sanitise. Returns either
  // the client-safe reason or the generic fallback — never a raw internal note.
  private safeRejectionReason(reasonEncrypted: Uint8Array | Buffer): string {
    let decrypted = '';
    try {
      const buf = Buffer.isBuffer(reasonEncrypted) ? reasonEncrypted : Buffer.from(reasonEncrypted);
      decrypted = this.crypto.decrypt(buf);
    } catch {
      decrypted = '';
    }
    const reason = decrypted.trim();

    if (reason.length < MIN_CLIENT_REASON_LENGTH) return GENERIC_REJECTION_FALLBACK; // empty / very short
    if (reason.includes('@')) return GENERIC_REJECTION_FALLBACK; // @-mentions, emails

    const digitCount = (reason.match(/\d/g) ?? []).length;
    if (digitCount / reason.length > 0.4) return GENERIC_REJECTION_FALLBACK; // ID-like / digit-heavy
    if (!/\s/.test(reason)) return GENERIC_REJECTION_FALLBACK; // single token, no spaces → looks like a code

    const lower = reason.toLowerCase();
    if (INTERNAL_MARKERS.some((m) => lower.includes(m))) return GENERIC_REJECTION_FALLBACK;

    return reason;
  }
}
