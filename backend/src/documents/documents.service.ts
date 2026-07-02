import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentUploadStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../common/r2/r2.service';
import { RequestUploadDto } from './dto/request-upload.dto';
import {
  checkCaseDocumentsAccess,
  DocumentsAccessMode,
} from './documents-access.helper';

// Documents step 3 — R2-backed case attachments.
//
// Five operations:
//   1. requestUpload   → create PENDING row + presigned PUT (no audit)
//   2. confirmUpload   → flip PENDING → UPLOADED + audit row (in tx)
//   3. listDocuments   → UPLOADED rows only, newest first, no r2Key leak
//   4. getDownloadUrl  → presigned GET + audit row
//   5. deleteDocument  → R2 delete first (no orphans), then DB row + audit
//
// All five gate via checkCaseDocumentsAccess. Every 403 writes a
// DOCUMENT_ACCESS_DENIED audit row before throwing.

export interface Actor {
  id: string;
  name: string | null;
  role: string | null;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  // ─── 1. Request presigned upload ───────────────────────────────────────
  async requestUpload(caseId: string, dto: RequestUploadDto, actor: Actor) {
    await this.assertAccess(caseId, null, 'POST /cases/:caseId/documents/request-upload', 'write', actor);

    const r2Key = this.buildR2Key(caseId, dto.originalName);

    const created = await this.prisma.document.create({
      data: {
        caseId,
        uploaderId: actor.id,
        r2Key,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        status: DocumentUploadStatus.PENDING,
      },
      select: { id: true, r2Key: true },
    });

    const uploadUrl = await this.r2.getPresignedUploadUrl(
      created.r2Key,
      dto.mimeType,
      300,
    );

    return {
      documentId: created.id,
      uploadUrl,
      r2Key: created.r2Key,
      expiresInSeconds: 300,
    };
  }

  // ─── 2. Confirm upload finished ────────────────────────────────────────
  async confirmUpload(caseId: string, documentId: string, actor: Actor) {
    await this.assertAccess(
      caseId,
      documentId,
      'POST /cases/:caseId/documents/:documentId/confirm',
      'write',
      actor,
    );

    const existing = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        caseId: true,
        status: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        r2Key: true,
      },
    });
    if (!existing || existing.caseId !== caseId) {
      throw new NotFoundException('Document not found on this case.');
    }
    if (existing.status !== DocumentUploadStatus.PENDING) {
      throw new BadRequestException(
        `Document is not in PENDING state (current: ${existing.status}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id: documentId },
        data: { status: DocumentUploadStatus.UPLOADED },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          status: true,
          category: true,
          createdAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DOCUMENT_UPLOAD',
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: documentId,
          newValue: {
            caseId,
            fileName: existing.originalName,
            mimeType: existing.mimeType,
            sizeBytes: existing.sizeBytes,
            r2Key: existing.r2Key,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role,
        },
      });
      return updated;
    });
  }

  // ─── 3. List a case's uploaded documents ───────────────────────────────
  async listDocuments(caseId: string, actor: Actor) {
    await this.assertAccess(
      caseId,
      null,
      'GET /cases/:caseId/documents',
      'read',
      actor,
    );

    const rows = await this.prisma.document.findMany({
      where: { caseId, status: DocumentUploadStatus.UPLOADED },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        category: true,
        status: true,
        createdAt: true,
        uploaderId: true,
        uploader: { select: { name: true } },
      },
    });

    // Strip the uploader relation into a flat name field and DO NOT
    // surface r2Key. The select above already excludes r2Key, but
    // shaping the response here keeps the contract explicit.
    return rows.map((r) => ({
      id: r.id,
      originalName: r.originalName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      category: r.category,
      status: r.status,
      createdAt: r.createdAt,
      uploaderId: r.uploaderId,
      uploaderName: r.uploader?.name ?? null,
    }));
  }

  // ─── 3b. Cross-case "my documents" — assignment-based, least-access ────
  // Lists UPLOADED documents for cases where the caller is CURRENTLY a slot
  // holder (liaId / ownerId / supportId / financeId), resolved live from the
  // Case columns — so a reassign-away instantly drops the case from this list.
  // Admin tier sees all. This is the server-side gate for the list; per-doc
  // download is separately gated by getDownloadUrl → checkCaseDocumentsAccess.
  // Never leaks r2Key.
  async listMyDocuments(actor: Actor) {
    const isAdmin = !!actor.role && ['OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(actor.role);
    const where: Prisma.DocumentWhereInput = {
      status: DocumentUploadStatus.UPLOADED,
      ...(isAdmin
        ? {}
        : {
            case: {
              OR: [
                { liaId: actor.id },
                { ownerId: actor.id },
                { supportId: actor.id },
                { financeId: actor.id },
              ],
            },
          }),
    };

    const rows = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        caseId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        category: true,
        createdAt: true,
        uploader: { select: { name: true } },
        case: {
          select: {
            stage: true,
            lead: { select: { contact: { select: { fullName: true, email: true } } } },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      originalName: r.originalName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      category: r.category,
      createdAt: r.createdAt,
      uploaderName: r.uploader?.name ?? null,
      stage: r.case?.stage ?? null,
      clientName: r.case?.lead?.contact?.fullName || r.case?.lead?.contact?.email || 'Client',
    }));
  }

  // ─── 4. Issue a presigned download URL ─────────────────────────────────
  async getDownloadUrl(caseId: string, documentId: string, actor: Actor) {
    await this.assertAccess(
      caseId,
      documentId,
      'GET /cases/:caseId/documents/:documentId/download-url',
      'read',
      actor,
    );

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        caseId: true,
        status: true,
        r2Key: true,
        originalName: true,
      },
    });
    if (!doc || doc.caseId !== caseId) {
      throw new NotFoundException('Document not found on this case.');
    }
    if (doc.status !== DocumentUploadStatus.UPLOADED) {
      throw new NotFoundException('Document not found on this case.');
    }

    // 60s TTL (was 300): least-access for PII — narrows the window in which an
    // already-issued URL keeps working after a reassign-away. The client opens
    // the URL immediately, so 60s is ample.
    const url = await this.r2.getPresignedDownloadUrl(doc.r2Key, 60);

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'DOCUMENT_DOWNLOAD',
        eventType: 'DOCUMENT_DOWNLOAD_URL_ISSUED',
        entityType: 'DOCUMENT',
        entityId: documentId,
        newValue: {
          caseId,
          fileName: doc.originalName,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name,
        actorRoleSnapshot: actor.role,
      },
    });

    return { url, expiresInSeconds: 60 };
  }

  // ─── 5. Delete a document ──────────────────────────────────────────────
  async deleteDocument(caseId: string, documentId: string, actor: Actor) {
    await this.assertAccess(
      caseId,
      documentId,
      'DELETE /cases/:caseId/documents/:documentId',
      'delete',
      actor,
    );

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, caseId: true, originalName: true, r2Key: true },
    });
    if (!doc || doc.caseId !== caseId) {
      throw new NotFoundException('Document not found on this case.');
    }

    // R2 first — if this fails, leave the row intact so the caller
    // can retry. The audit row + DB delete only run after R2 succeeds.
    try {
      await this.r2.deleteObject(doc.r2Key);
    } catch (err) {
      throw new InternalServerErrorException(
        'Failed to delete file from storage. The document was not removed; please retry.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DOCUMENT_DELETE',
          eventType: 'DOCUMENT_REMOVED',
          entityType: 'DOCUMENT',
          entityId: documentId,
          oldValue: {
            caseId,
            fileName: doc.originalName,
            r2Key: doc.r2Key,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role,
        },
      });
      await tx.document.delete({ where: { id: documentId } });
    });

    return { deleted: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  // Single entry point for access enforcement. Loads the case once,
  // routes the result to the right HTTP status, and emits a
  // DOCUMENT_ACCESS_DENIED audit row on every denial before throwing.
  private async assertAccess(
    caseId: string,
    attemptedDocumentId: string | null,
    endpoint: string,
    mode: DocumentsAccessMode,
    actor: Actor,
  ): Promise<void> {
    const result = await checkCaseDocumentsAccess(
      this.prisma,
      caseId,
      { userId: actor.id, role: actor.role },
      mode,
    );
    if (result === 'allow') return;
    if (result === 'case-not-found') {
      throw new NotFoundException('Case not found');
    }
    // result === 'deny' — audit the attempt, then forbid.
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'DOCUMENT_ACCESS_DENIED',
        eventType: 'DOCUMENT_ACCESS_DENIED',
        entityType: 'CASE',
        entityId: caseId,
        newValue: {
          attemptedDocumentId,
          endpoint,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name,
        actorRoleSnapshot: actor.role,
      },
    });
    throw new ForbiddenException('You do not have access to this case.');
  }

  // Build a deterministic R2 object key: cases/<caseId>/<uuid>-<safe-name>.
  // The UUID guarantees uniqueness; the sanitised original name is purely
  // for human-readability inside the bucket. The unique constraint on
  // Document.r2Key would also catch any collision at the DB layer.
  private buildR2Key(caseId: string, originalName: string): string {
    const safe = originalName
      .replace(/[^\w.-]/g, '_') // drop path separators + non-word chars
      .slice(0, 100);
    return `cases/${caseId}/${randomUUID()}-${safe}`;
  }
}
