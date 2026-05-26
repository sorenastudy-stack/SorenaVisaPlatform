import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  EditInzSubmissionDto,
  RevertInzSubmissionDto,
  SubmitToInzDto,
} from './dto/inz-submission.dto';

// PR-LIA-7 — INZ submission lifecycle.
//
// Three methods: submit (one-shot transition VISA → INZ_SUBMITTED with
// receipt upload), edit (in-place metadata edit while in INZ_SUBMITTED),
// revert (rollback to VISA, requires reason, leaves the receipt on
// disk for recovery).
//
// Receipt storage: file metadata is denormalised onto Case (one receipt
// per case, lifecycle bound to the submission). The actual bytes live
// under ./uploads/inz-receipts/<caseId>/, mirroring the admission
// upload pattern. Downloads go through the existing
// /files/signed/:token route — the LIA UI requests a download URL,
// gets a 5-minute JWT.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const INZ_RECEIPT_DIR = path.join(UPLOAD_DIR, 'inz-receipts');
const ALLOWED_RECEIPT_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

@Injectable()
export class InzSubmissionService {
  private readonly logger = new Logger(InzSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Submit ────────────────────────────────────────────────────────────

  async submitToInz(
    caseId: string,
    dto: SubmitToInzDto,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ) {
    if (!file) {
      throw new BadRequestException('Payment receipt file is required.');
    }
    if (!ALLOWED_RECEIPT_MIMES.has(file.mimetype)) {
      // Best-effort: clean up the rejected upload from the pending dir.
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Unsupported receipt type "${file.mimetype}". Allowed: PDF, JPEG, PNG, HEIC.`,
      );
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Receipt is ${file.size} bytes; maximum is ${MAX_RECEIPT_BYTES}.`,
      );
    }

    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        lead: { include: { contact: true } },
      },
    });
    if (!existing) {
      this.unlinkSilently(file.path);
      throw new NotFoundException('Case not found');
    }
    if (existing.stage !== 'VISA') {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Case must be in VISA stage to submit to INZ (current: ${existing.stage}).`,
      );
    }
    if (!existing.liaId) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        'Case must have an assigned LIA before submitting to INZ.',
      );
    }
    if (existing.inzApplicationNumber || existing.inzSubmittedAt) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        'INZ submission already recorded on this case. Use the edit or revert endpoint to change it.',
      );
    }

    // Move the file from /uploads/pending/ to /uploads/inz-receipts/<caseId>/
    // with a deterministic name. The original filename is preserved as
    // metadata on Case (inzReceiptFileName) so the LIA still sees a
    // human-readable name on download.
    const destDir = path.join(INZ_RECEIPT_DIR, caseId);
    await fs.promises.mkdir(destDir, { recursive: true });
    const ext = path.extname(file.originalname) || this.extFromMime(file.mimetype);
    const stamp = (dto.submittedAt ?? new Date()).getTime();
    const destBasename = `inz-receipt-${caseId}-${stamp}${ext}`;
    const destPath = path.join(destDir, destBasename);
    try {
      await fs.promises.rename(file.path, destPath);
    } catch (err: any) {
      // Cross-device renames fail on EXDEV — fall back to copy+unlink.
      if (err?.code === 'EXDEV') {
        await fs.promises.copyFile(file.path, destPath);
        this.unlinkSilently(file.path);
      } else {
        this.unlinkSilently(file.path);
        throw err;
      }
    }

    const submittedAt = dto.submittedAt ?? new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data: {
          stage: 'INZ_SUBMITTED',
          inzApplicationNumber: dto.inzApplicationNumber.trim(),
          inzSubmittedAt: submittedAt,
          inzSubmissionNotes: dto.notes?.trim() || null,
          inzReceiptFileUrl: destPath,
          inzReceiptFileName: file.originalname,
          inzReceiptMimeType: file.mimetype,
          inzReceiptSizeBytes: file.size,
        },
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'INZ_SUBMITTED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            caseId,
            inzApplicationNumber: dto.inzApplicationNumber,
            receiptFileName: file.originalname,
            receiptSizeBytes: file.size,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const visaCaseId = await this.resolveVisaCaseId(tx, caseId);
      if (visaCaseId) {
        await tx.visaCaseFileNote.create({
          data: {
            caseId: visaCaseId,
            noteType: 'SYSTEM_EVENT',
            referenceId: caseId,
            summaryEncrypted: this.crypto.encrypt(
              `INZ submission: ${dto.inzApplicationNumber}`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return u;
    });

    // Best-effort client email. Fire-and-forget; failures log only.
    const clientEmail = updated.lead?.contact?.email ?? null;
    const clientName = updated.lead?.contact?.fullName ?? null;
    if (clientEmail) {
      this.notifications
        .sendInzSubmittedToClient(
          clientEmail,
          clientName ?? 'there',
          caseId,
          dto.inzApplicationNumber,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to email client on INZ submission: ${err?.message ?? err}`,
          ),
        );
    } else {
      this.logger.warn(
        `INZ submission recorded for case ${caseId} but no client email on file.`,
      );
    }

    return updated;
  }

  // ─── Edit ──────────────────────────────────────────────────────────────

  async editInzSubmission(
    caseId: string,
    dto: EditInzSubmissionDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
    });
    if (!existing) throw new NotFoundException('Case not found');
    if (existing.stage !== 'INZ_SUBMITTED') {
      throw new BadRequestException(
        'Edit is only allowed on cases currently in INZ_SUBMITTED stage.',
      );
    }

    const data: Prisma.CaseUpdateInput = {};
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    if (dto.inzApplicationNumber !== undefined) {
      data.inzApplicationNumber = dto.inzApplicationNumber.trim();
      previous.inzApplicationNumber = existing.inzApplicationNumber;
      next.inzApplicationNumber = data.inzApplicationNumber;
    }
    if (dto.submittedAt !== undefined) {
      data.inzSubmittedAt = dto.submittedAt;
      previous.inzSubmittedAt = existing.inzSubmittedAt;
      next.inzSubmittedAt = data.inzSubmittedAt;
    }
    if (dto.notes !== undefined) {
      data.inzSubmissionNotes = dto.notes.trim() || null;
      previous.inzSubmissionNotes = existing.inzSubmissionNotes;
      next.inzSubmissionNotes = data.inzSubmissionNotes;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No editable fields provided.');
    }

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data,
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'INZ_SUBMISSION_EDITED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: previous as Prisma.InputJsonValue,
          newValue: next as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const visaCaseId = await this.resolveVisaCaseId(tx, caseId);
      if (visaCaseId) {
        await tx.visaCaseFileNote.create({
          data: {
            caseId: visaCaseId,
            noteType: 'SYSTEM_EVENT',
            referenceId: caseId,
            summaryEncrypted: this.crypto.encrypt(
              `INZ submission edited (${Object.keys(next).join(', ')})`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return u;
    });
  }

  // ─── Revert ────────────────────────────────────────────────────────────

  async revertInzSubmission(
    caseId: string,
    dto: RevertInzSubmissionDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
    });
    if (!existing) throw new NotFoundException('Case not found');
    if (existing.stage !== 'INZ_SUBMITTED') {
      throw new BadRequestException(
        'Revert is only allowed on cases currently in INZ_SUBMITTED stage.',
      );
    }
    // Forward-compat for PR-LIA-8 (visa issued). For now we don't have
    // a `visaIssued` flag on Case; once it exists, gate here.
    // if (existing.visaIssued === true) throw new BadRequestException(...)

    // Encrypt the reason — this is sensitive operator commentary.
    const reasonEncrypted = this.crypto.encrypt(dto.reason);

    const previousSnapshot = {
      stage: existing.stage,
      inzApplicationNumber: existing.inzApplicationNumber,
      inzSubmittedAt: existing.inzSubmittedAt,
      inzReceiptFileName: existing.inzReceiptFileName,
    };

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data: {
          stage: 'VISA',
          inzApplicationNumber: null,
          inzSubmittedAt: null,
          inzSubmissionNotes: null,
          inzReceiptFileUrl: null,
          inzReceiptFileName: null,
          inzReceiptMimeType: null,
          inzReceiptSizeBytes: null,
        },
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'INZ_SUBMISSION_REVERTED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: previousSnapshot as Prisma.InputJsonValue,
          newValue: {
            stage: 'VISA',
            reasonEncryptedBase64: reasonEncrypted.toString('base64'),
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const visaCaseId = await this.resolveVisaCaseId(tx, caseId);
      if (visaCaseId) {
        await tx.visaCaseFileNote.create({
          data: {
            caseId: visaCaseId,
            noteType: 'SYSTEM_EVENT',
            referenceId: caseId,
            summaryEncrypted: this.crypto.encrypt(
              `INZ submission reverted (was ${previousSnapshot.inzApplicationNumber ?? '?'})`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return u;
    });
  }

  // ─── Receipt download (signed URL) ─────────────────────────────────────

  async getReceiptInfo(caseId: string) {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        inzReceiptFileUrl: true,
        inzReceiptFileName: true,
        inzReceiptMimeType: true,
      },
    });
    if (!c || !c.inzReceiptFileUrl) {
      throw new NotFoundException('No INZ receipt on this case.');
    }
    return {
      fileUrl: c.inzReceiptFileUrl,
      fileName: c.inzReceiptFileName ?? 'inz-receipt',
      mimeType: c.inzReceiptMimeType ?? 'application/octet-stream',
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private unlinkSilently(p: string | undefined) {
    if (!p) return;
    fs.promises.unlink(p).catch(() => undefined);
  }

  private extFromMime(mime: string): string {
    switch (mime) {
      case 'application/pdf': return '.pdf';
      case 'image/jpeg':       return '.jpg';
      case 'image/png':        return '.png';
      case 'image/heic':       return '.heic';
      case 'image/heif':       return '.heif';
      default:                  return '';
    }
  }

  // Resolve the VisaCase id (if any) for a CRM Case. Same chain used
  // by PR-LIA-4 / PR-LIA-5 — Case → AdmissionApplication →
  // VisaApplication → VisaCase. Used to attach a companion
  // VisaCaseFileNote on each mutation when the visa-side workspace
  // exists. Pre-visa cases skip the note write.
  private async resolveVisaCaseId(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<string | null> {
    const admission = await tx.admissionApplication.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!admission) return null;
    const visa = await tx.visaApplication.findUnique({
      where: { applicationId: admission.id },
      select: { id: true },
    });
    if (!visa) return null;
    const vc = await tx.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
      select: { id: true },
    });
    return vc?.id ?? null;
  }
}
