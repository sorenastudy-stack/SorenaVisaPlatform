import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CaseDocumentReviewSource,
  CaseDocumentReviewStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { createSignedDownloadToken } from '../common/signed-url.util';
import { ReviewDocumentDto } from './dto/case-documents.dto';

// PR-LIA-5 — Cross-source document listing + signed-URL downloads +
// internal-only review verdicts.
//
// Sources: ADMISSION (AdmissionDocument, has fileUrl), APPLICATION
// (ApplicationDocument, optional fileUrl), VISA_SUPPORTING
// (VisaSupportingDocument parent + VisaSupportingDocumentFile children
// — PR-FILES-2; downloadable iff the parent has >=1 child file).
//
// The user's original spec mentioned a fourth source
// (CASE_MESSAGE_FULFILMENT). That's not a separate model — it's just
// a CaseMessage with a FK to a VisaSupportingDocument row. The
// canonical doc is the VisaSupportingDocument, so it's surfaced under
// VISA_SUPPORTING. The list response includes `linkedToRequestMessageId`
// when applicable so the UI can show "fulfilled a document request".

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface CaseDocumentRow {
  id: string;                                       // composite "<source>:<rowId>"
  source: CaseDocumentReviewSource;
  sourceRowId: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedById: string | null;
  uploadedByName: string | null;
  downloadable: boolean;
  linkedToRequestMessageId: string | null;
  liaReviewStatus: 'UNREVIEWED' | CaseDocumentReviewStatus;
  liaReviewedAt: Date | null;
  liaReviewedById: string | null;
  liaReviewedByName: string | null;
  liaReviewReason: string | null;
}

// OPS cross-case review queue row (one unreviewed document).
export interface OpsUnreviewedDocumentRow {
  caseId: string;
  caseReference: string | null;   // inzApplicationNumber when present
  caseLabel: string;              // reference, or a short "Case xxxxxxxx" fallback
  clientName: string | null;
  source: CaseDocumentReviewSource;
  sourceRowId: string;
  fileName: string;
  uploaderId: string | null;
  uploaderName: string | null;
  createdAt: Date;
}

@Injectable()
export class CaseDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────

  async listAllDocumentsForCase(
    caseId: string,
    viewerRole?: string | null,
  ): Promise<CaseDocumentRow[]> {
    await this.ensureCaseExists(caseId);

    // 1. Admission documents — Case → AdmissionApplication → AdmissionDocument.
    //    Pull the client name via the case's lead → contact for display.
    const admissions = await this.prisma.admissionApplication.findMany({
      where: { caseId },
      select: {
        id: true,
        documents: {
          select: {
            id: true,
            documentType: true,
            fileName: true,
            mimeType: true,
            fileSizeBytes: true,
            uploadedAt: true,
            fileUrl: true,
          },
        },
      },
    });

    // 2. Application documents — Case → Application → ApplicationDocument.
    const applications = await this.prisma.application.findMany({
      where: { caseId },
      select: {
        id: true,
        documents: {
          select: {
            id: true,
            type: true,
            fileName: true,
            fileUrl: true,
            createdAt: true,
            status: true,
          },
        },
      },
    });

    // 3. Visa supporting documents — Case → AdmissionApplication →
    //    VisaApplication → VisaSupportingDocument (parent) → files[]
    //    (children). PR-FILES-2: file metadata lives on the children;
    //    one row per parent in the listing, using the most recent
    //    file's metadata for display and counting files for the
    //    downloadable flag.
    const admissionIds = admissions.map((a) => a.id);
    const visaApps = admissionIds.length
      ? await this.prisma.visaApplication.findMany({
          where: { applicationId: { in: admissionIds } },
          select: {
            id: true,
            supportingDocuments: {
              select: {
                id: true,
                documentType: true,
                createdAt: true,
                files: {
                  orderBy: { uploadedAt: 'desc' },
                  select: {
                    id: true,
                    originalFilename: true,
                    mimeType: true,
                    sizeBytes: true,
                    uploadedAt: true,
                  },
                },
                fulfilmentMessages: {
                  where: { caseId },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        })
      : [];

    // 4. All existing review verdicts on this case (single query, joined
    //    in memory).
    const reviews = await this.prisma.caseDocumentReview.findMany({
      where: { caseId },
      include: { reviewedBy: { select: { id: true, name: true } } },
    });
    const reviewByKey = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) reviewByKey.set(this.reviewKey(r.source, r.sourceRowId), r);

    // Client display name — same for every row on a case.
    const clientNameRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        lead: {
          select: { contact: { select: { userId: true, fullName: true } } },
        },
      },
    });
    const clientUserId = clientNameRow?.lead?.contact?.userId ?? null;
    const clientName = clientNameRow?.lead?.contact?.fullName ?? null;

    const rows: CaseDocumentRow[] = [];

    for (const adm of admissions) {
      for (const d of adm.documents) {
        rows.push(
          this.shapeRow({
            source: 'ADMISSION',
            sourceRowId: d.id,
            docType: String(d.documentType),
            fileName: d.fileName,
            mimeType: d.mimeType,
            sizeBytes: d.fileSizeBytes,
            uploadedAt: d.uploadedAt,
            uploadedById: clientUserId,
            uploadedByName: clientName,
            downloadable: !!d.fileUrl,
            linkedToRequestMessageId: null,
            review: reviewByKey.get(this.reviewKey('ADMISSION', d.id)),
          }),
        );
      }
    }

    for (const app of applications) {
      for (const d of app.documents) {
        rows.push(
          this.shapeRow({
            source: 'APPLICATION',
            sourceRowId: d.id,
            docType: d.type,
            fileName: d.fileName ?? '(unnamed)',
            mimeType: 'application/octet-stream',
            sizeBytes: 0,
            uploadedAt: d.createdAt,
            uploadedById: clientUserId,
            uploadedByName: clientName,
            downloadable: !!d.fileUrl,
            linkedToRequestMessageId: null,
            review: reviewByKey.get(this.reviewKey('APPLICATION', d.id)),
          }),
        );
      }
    }

    for (const va of visaApps) {
      for (const d of va.supportingDocuments) {
        // PR-FILES-2 — surface one row per parent. Display the latest
        // file's metadata; `fileName` falls back to a synthetic label
        // when the parent has no files yet. downloadable = there's at
        // least one child file (in which case createDownloadUrl
        // returns the first child's signed URL).
        const latest = d.files[0]; // ordered desc by uploadedAt
        rows.push(
          this.shapeRow({
            source: 'VISA_SUPPORTING',
            sourceRowId: d.id,
            docType: String(d.documentType),
            fileName: latest
              ? (d.files.length > 1
                  ? `${latest.originalFilename} (+${d.files.length - 1} more)`
                  : latest.originalFilename)
              : '(no file uploaded)',
            mimeType: latest?.mimeType ?? 'application/octet-stream',
            sizeBytes: latest?.sizeBytes ?? 0,
            uploadedAt: latest?.uploadedAt ?? d.createdAt,
            uploadedById: clientUserId,
            uploadedByName: clientName,
            // PR-FILES-2: downloadable iff the parent has >=1 child file.
            downloadable: d.files.length > 0,
            linkedToRequestMessageId: d.fulfilmentMessages[0]?.id ?? null,
            review: reviewByKey.get(this.reviewKey('VISA_SUPPORTING', d.id)),
          }),
        );
      }
    }

    rows.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    // Tighter isolation: OPERATIONS never even sees VISA_SUPPORTING (legal)
    // documents in the list. LIA + admin tier see everything.
    const visible =
      viewerRole === 'OPERATIONS'
        ? rows.filter((r) => r.source !== 'VISA_SUPPORTING')
        : rows;
    return visible;
  }

  // ─── OPS cross-case review queue ─────────────────────────────────────────
  // Every uploaded document across ACTIVE cases (stage not COMPLETED/WITHDRAWN)
  // that has NO CaseDocumentReview verdict yet. "Unreviewed" = no review row
  // (rows only ever exist as APPROVED/REJECTED). Only documents that actually
  // have an uploaded file are surfaced (ADMISSION always; APPLICATION where
  // fileUrl is set; VISA_SUPPORTING where >=1 file) — an empty placeholder has
  // nothing to review. Oldest-first so the longest-waiting doc is at the top.
  // Reuses the same three sources as listAllDocumentsForCase; adds no models.
  // Access is enforced at the controller (OPERATIONS + admin tier) — this
  // deliberately reads across all cases.
  async listUnreviewedAcrossCases(): Promise<OpsUnreviewedDocumentRow[]> {
    const cases = await this.prisma.case.findMany({
      where: { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
      select: {
        id: true,
        inzApplicationNumber: true,
        lead: { select: { contact: { select: { userId: true, fullName: true } } } },
      },
    });
    if (cases.length === 0) return [];

    const meta = new Map<
      string,
      { clientName: string | null; clientUserId: string | null; caseReference: string | null }
    >();
    for (const c of cases) {
      meta.set(c.id, {
        clientName: c.lead?.contact?.fullName ?? null,
        clientUserId: c.lead?.contact?.userId ?? null,
        caseReference: c.inzApplicationNumber ?? null,
      });
    }
    const activeCaseIds = cases.map((c) => c.id);

    // A document is "reviewed" iff a CaseDocumentReview row exists for its
    // (source, sourceRowId). Build the exclusion set in one query.
    const reviews = await this.prisma.caseDocumentReview.findMany({
      where: { caseId: { in: activeCaseIds } },
      select: { source: true, sourceRowId: true },
    });
    const reviewed = new Set(reviews.map((r) => this.reviewKey(r.source, r.sourceRowId)));

    const rows: OpsUnreviewedDocumentRow[] = [];
    const push = (
      caseId: string,
      source: CaseDocumentReviewSource,
      sourceRowId: string,
      fileName: string,
      createdAt: Date,
    ) => {
      const m = meta.get(caseId);
      if (!m) return;
      rows.push({
        caseId,
        caseReference: m.caseReference,
        caseLabel: m.caseReference ?? `Case ${caseId.slice(0, 8)}`,
        clientName: m.clientName,
        source,
        sourceRowId,
        fileName,
        uploaderId: m.clientUserId,
        uploaderName: m.clientName,
        createdAt,
      });
    };

    // 1. ADMISSION — AdmissionDocument (fileName/fileUrl are required — always a real file).
    const admissions = await this.prisma.admissionApplication.findMany({
      where: { caseId: { in: activeCaseIds } },
      select: {
        caseId: true,
        documents: { select: { id: true, fileName: true, uploadedAt: true } },
      },
    });
    for (const a of admissions) {
      for (const d of a.documents) {
        if (reviewed.has(this.reviewKey('ADMISSION', d.id))) continue;
        push(a.caseId, 'ADMISSION', d.id, d.fileName, d.uploadedAt);
      }
    }

    // 2. APPLICATION — only rows with an actual file (MISSING placeholders have
    //    nothing to review).
    const applications = await this.prisma.application.findMany({
      where: { caseId: { in: activeCaseIds } },
      select: {
        caseId: true,
        documents: { select: { id: true, fileName: true, fileUrl: true, createdAt: true } },
      },
    });
    for (const app of applications) {
      for (const d of app.documents) {
        if (!d.fileUrl) continue;
        if (reviewed.has(this.reviewKey('APPLICATION', d.id))) continue;
        push(app.caseId, 'APPLICATION', d.id, d.fileName ?? '(unnamed)', d.createdAt);
      }
    }

    // NOTE: VISA_SUPPORTING is intentionally EXCLUDED from the OPS queue —
    // visa (legal) documents are the LIA's review scope, not Operations'. This
    // queue only surfaces ADMISSION + APPLICATION (admission-specialist) work.

    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // oldest-first
    return rows;
  }

  // ─── Download URL ──────────────────────────────────────────────────────

  async createDownloadUrl(
    caseId: string,
    source: CaseDocumentReviewSource,
    sourceRowId: string,
    actor: Actor,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    // Source gate first (fail fast, no existence leak): OPS cannot download visa docs.
    this.assertCanAccessSource(actor.role, source);
    const row = await this.resolveSourceRow(caseId, source, sourceRowId);
    if (!row.fileUrl) {
      throw new BadRequestException(
        'This document is metadata-only — file bytes have not been collected.',
      );
    }

    const token = createSignedDownloadToken({
      fileUrl: row.fileUrl,
      fileName: row.fileName,
      mimeType: row.mimeType,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'DOWNLOAD',
        eventType: 'LIA_DOCUMENT_DOWNLOADED',
        entityType: 'CASE',
        entityId: caseId,
        newValue: {
          source,
          sourceRowId,
          fileName: row.fileName,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    return { url: `/files/signed/${token}`, expiresInSeconds: 5 * 60 };
  }

  // ─── Review upsert / clear ─────────────────────────────────────────────

  async upsertReview(
    caseId: string,
    source: CaseDocumentReviewSource,
    sourceRowId: string,
    dto: ReviewDocumentDto,
    actor: Actor,
  ) {
    // Source gate first (fail fast, no existence leak): OPS cannot review visa docs.
    this.assertCanAccessSource(actor.role, source);
    // Verify the source row belongs to this case before we attach a review.
    await this.resolveSourceRow(caseId, source, sourceRowId);

    const existing = await this.prisma.caseDocumentReview.findUnique({
      where: { source_sourceRowId: { source, sourceRowId } },
    });

    const reasonEncrypted = this.crypto.encrypt(dto.reason) as never;

    return this.prisma.$transaction(async (tx) => {
      const upserted = await tx.caseDocumentReview.upsert({
        where: { source_sourceRowId: { source, sourceRowId } },
        update: {
          status: dto.status,
          reasonEncrypted,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
        create: {
          caseId,
          source,
          sourceRowId,
          status: dto.status,
          reasonEncrypted,
          reviewedById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: existing ? 'UPDATE' : 'CREATE',
          eventType: 'LIA_DOCUMENT_REVIEWED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: existing
            ? ({
                status: existing.status,
                source,
                sourceRowId,
              } as Prisma.InputJsonValue)
            : (null as never),
          newValue: {
            status: dto.status,
            source,
            sourceRowId,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      // Best-effort companion VisaCaseFileNote (PR-LIA-1/PR-LIA-4
      // pattern — only when a VisaCase resolves through the
      // Case → AdmissionApplication → VisaApplication → VisaCase chain).
      const visaCaseId = await this.resolveVisaCaseId(caseId);
      if (visaCaseId) {
        const summary = `LIA ${dto.status === 'APPROVED' ? 'approved' : 'rejected'} a ${source} document`;
        await tx.visaCaseFileNote.create({
          data: {
            caseId: visaCaseId,
            noteType: 'SYSTEM_EVENT',
            referenceId: upserted.id,
            summaryEncrypted: this.crypto.encrypt(summary) as never,
            createdById: actor.id,
          },
        });
      }

      return upserted;
    });
  }

  async clearReview(
    caseId: string,
    source: CaseDocumentReviewSource,
    sourceRowId: string,
    actor: Actor,
  ) {
    // Source gate first (fail fast, no existence leak): OPS cannot clear visa reviews.
    this.assertCanAccessSource(actor.role, source);
    const existing = await this.prisma.caseDocumentReview.findUnique({
      where: { source_sourceRowId: { source, sourceRowId } },
    });
    if (!existing) {
      throw new NotFoundException('No existing review to clear.');
    }
    if (existing.caseId !== caseId) {
      throw new NotFoundException('No existing review to clear.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.caseDocumentReview.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DELETE',
          eventType: 'LIA_DOCUMENT_REVIEWED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            status: existing.status,
            source,
            sourceRowId,
          } as Prisma.InputJsonValue,
          newValue: {
            status: 'CLEARED',
            source,
            sourceRowId,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return { cleared: true };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async ensureCaseExists(caseId: string) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
  }

  // Resolve a source-table row by id and confirm it belongs to the
  // requested case. Returns 404 (not 403) on mismatch so we don't
  // leak whether the row exists at all. Returns a normalised
  // { fileUrl?, fileName, mimeType } object.
  private async resolveSourceRow(
    caseId: string,
    source: CaseDocumentReviewSource,
    sourceRowId: string,
  ): Promise<{ fileUrl: string | null; fileName: string; mimeType: string }> {
    if (source === 'ADMISSION') {
      const d = await this.prisma.admissionDocument.findUnique({
        where: { id: sourceRowId },
        include: { admissionApplication: { select: { caseId: true } } },
      });
      if (!d || d.admissionApplication.caseId !== caseId) {
        throw new NotFoundException('Document not found on this case.');
      }
      return { fileUrl: d.fileUrl, fileName: d.fileName, mimeType: d.mimeType };
    }
    if (source === 'APPLICATION') {
      const d = await this.prisma.applicationDocument.findUnique({
        where: { id: sourceRowId },
        include: { application: { select: { caseId: true } } },
      });
      if (!d || d.application.caseId !== caseId) {
        throw new NotFoundException('Document not found on this case.');
      }
      return {
        fileUrl: d.fileUrl ?? null,
        fileName: d.fileName ?? '(unnamed)',
        mimeType: 'application/octet-stream',
      };
    }
    // VISA_SUPPORTING — Case → AdmissionApplication → VisaApplication
    // → VisaSupportingDocument (parent) → files[]. PR-FILES-2: file
    // metadata lives on the children; this listing's `sourceRowId` is
    // the PARENT id, so we pick the most recent child file's URL for
    // the signed download. Callers that need per-file granularity
    // should use the inz-data per-file download endpoint instead.
    const parent = await this.prisma.visaSupportingDocument.findUnique({
      where: { id: sourceRowId },
      select: {
        visaApplicationId: true,
        files: {
          orderBy: { uploadedAt: 'desc' },
          take: 1,
          select: { fileUrl: true, originalFilename: true, mimeType: true },
        },
      },
    });
    if (!parent) throw new NotFoundException('Document not found on this case.');
    const visa = await this.prisma.visaApplication.findUnique({
      where: { id: parent.visaApplicationId },
      select: { applicationId: true },
    });
    if (!visa) throw new NotFoundException('Document not found on this case.');
    const admission = await this.prisma.admissionApplication.findUnique({
      where: { id: visa.applicationId },
      select: { caseId: true },
    });
    if (!admission || admission.caseId !== caseId) {
      throw new NotFoundException('Document not found on this case.');
    }
    const latest = parent.files[0];
    if (!latest) {
      // Parent exists but no files yet — caller's download endpoint
      // rejects with the existing "metadata-only" path.
      return { fileUrl: null, fileName: '(no file)', mimeType: 'application/octet-stream' };
    }
    return {
      fileUrl: latest.fileUrl,
      fileName: latest.originalFilename,
      mimeType: latest.mimeType,
    };
  }

  private async resolveVisaCaseId(caseId: string): Promise<string | null> {
    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!admission) return null;
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) return null;
    const vc = await this.prisma.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
    });
    return vc?.id ?? null;
  }

  private reviewKey(source: CaseDocumentReviewSource, sourceRowId: string) {
    return `${source}:${sourceRowId}`;
  }

  // Source-based access gate. OPERATIONS (Admission Specialists) may only touch
  // ADMISSION/APPLICATION documents; VISA_SUPPORTING (legal review) stays with
  // LIA + admin tier. The role is passed in from the VERIFIED JWT (req.user.role
  // via the controller's actor()), never from client input — so an OPS user
  // cannot review, download, or list a visa document by crafting a request.
  // LIA + admin tier are unrestricted (no regression).
  private assertCanAccessSource(
    role: string | null | undefined,
    source: CaseDocumentReviewSource,
  ) {
    if (role === 'OPERATIONS' && source === 'VISA_SUPPORTING') {
      throw new ForbiddenException(
        'Operations may only access admission documents (ADMISSION / APPLICATION).',
      );
    }
  }

  private shapeRow(args: {
    source: CaseDocumentReviewSource;
    sourceRowId: string;
    docType: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: Date;
    uploadedById: string | null;
    uploadedByName: string | null;
    downloadable: boolean;
    linkedToRequestMessageId: string | null;
    review:
      | {
          status: CaseDocumentReviewStatus;
          reviewedAt: Date;
          reviewedBy: { id: string; name: string } | null;
          reviewedById: string;
          reasonEncrypted: Uint8Array | Buffer;
        }
      | undefined;
  }): CaseDocumentRow {
    let liaReviewReason: string | null = null;
    if (args.review) {
      try {
        const buf = Buffer.isBuffer(args.review.reasonEncrypted)
          ? args.review.reasonEncrypted
          : Buffer.from(args.review.reasonEncrypted);
        liaReviewReason = this.crypto.decrypt(buf);
      } catch {
        liaReviewReason = '';
      }
    }
    return {
      id: `${args.source}:${args.sourceRowId}`,
      source: args.source,
      sourceRowId: args.sourceRowId,
      docType: args.docType,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      uploadedAt: args.uploadedAt,
      uploadedById: args.uploadedById,
      uploadedByName: args.uploadedByName,
      downloadable: args.downloadable,
      linkedToRequestMessageId: args.linkedToRequestMessageId,
      liaReviewStatus: args.review?.status ?? 'UNREVIEWED',
      liaReviewedAt: args.review?.reviewedAt ?? null,
      liaReviewedById: args.review?.reviewedById ?? null,
      liaReviewedByName: args.review?.reviewedBy?.name ?? null,
      liaReviewReason,
    };
  }
}
