import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CaseDocumentReviewSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { p1GateVerdict, type ExistingDocument, type ReviewStatus } from './p1-gate.logic';

// PR-CHECKLIST item 7 — enforcement side of the P1/P2 progression gate.
//
// Called by the two CLIENT upload paths (admission documents, visa supporting
// documents) before anything is scanned or written, so a refused upload costs
// no bytes and leaves no row to clean up.
//
// Staff uploads are deliberately NOT gated: the rule is about the order a client
// submits their file in, and an LIA attaching something on the client's behalf
// is not that.
@Injectable()
export class P1GateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every client-uploaded document on the case, with its current verdict. */
  private async existingDocuments(caseId: string): Promise<ExistingDocument[]> {
    const admissions = await this.prisma.admissionApplication.findMany({
      where: { caseId },
      select: { id: true, documents: { select: { id: true, documentType: true } } },
    });
    const admissionIds = admissions.map((a) => a.id);
    const visaApps = admissionIds.length
      ? await this.prisma.visaApplication.findMany({
          where: { applicationId: { in: admissionIds } },
          select: { supportingDocuments: { select: { id: true, documentType: true } } },
        })
      : [];

    const reviews = await this.prisma.caseDocumentReview.findMany({
      where: { caseId, source: { in: ['ADMISSION', 'VISA_SUPPORTING'] as CaseDocumentReviewSource[] } },
      select: { source: true, sourceRowId: true, status: true },
    });
    // UNREVIEWED is the absence of a row, exactly as the review model defines it.
    const verdict = new Map(reviews.map((r) => [`${r.source}:${r.sourceRowId}`, r.status as ReviewStatus]));
    const statusOf = (source: CaseDocumentReviewSource, id: string): ReviewStatus =>
      verdict.get(`${source}:${id}`) ?? 'UNREVIEWED';

    const out: ExistingDocument[] = [];
    for (const adm of admissions) {
      for (const d of adm.documents) {
        out.push({ source: 'ADMISSION', docType: String(d.documentType), status: statusOf('ADMISSION', d.id) });
      }
    }
    for (const va of visaApps) {
      for (const d of va.supportingDocuments) {
        out.push({ source: 'VISA_SUPPORTING', docType: String(d.documentType), status: statusOf('VISA_SUPPORTING', d.id) });
      }
    }
    return out;
  }

  /**
   * Throw 403 if this client may not upload this document yet.
   *
   * Forbidden rather than BadRequest: the request is well-formed, the client is
   * simply not permitted to do it at this point in their file.
   */
  async assertMayUpload(
    caseId: string,
    incoming: { source: CaseDocumentReviewSource; docType: string },
  ): Promise<void> {
    const verdict = p1GateVerdict(await this.existingDocuments(caseId), incoming);
    if (!verdict.allowed) throw new ForbiddenException(verdict.reason);
  }
}
