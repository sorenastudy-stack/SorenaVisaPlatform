import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MailService } from '../../mail/mail.service';
import {
  DeclineVisaDto,
  EditVisaDto,
  IssueVisaDto,
  RevertVisaDto,
} from './dto/visa.dto';

// PR-LIA-8 — Visa lifecycle.
//
// Symmetric to PR-LIA-7 but for the OUTCOME side of the workflow. The
// case moves INZ_SUBMITTED → COMPLETED on either outcome (APPROVED or
// DECLINED). Revert un-issues — deletes the Visa row and rolls the
// case back to INZ_SUBMITTED.
//
// Visa file storage mirrors the INZ-receipt pattern: Multer drops the
// file in ./uploads/pending/, this service moves it to
// ./uploads/visas/<caseId>/ and stores the path on Visa. Downloads
// flow through the existing /files/signed/:token route — controller
// returns a 5-minute signed URL.
//
// Email: best-effort, fire-and-forget, never blocks the transaction.
// The DECLINE email never includes the LIA's internal reason; the
// client only learns that the application wasn't approved.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const VISA_FILE_DIR = path.join(UPLOAD_DIR, 'visas');
const ALLOWED_VISA_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);
const MAX_VISA_BYTES = 10 * 1024 * 1024;

@Injectable()
export class VisaService {
  private readonly logger = new Logger(VisaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
  ) {}

  // ─── Issue (APPROVED) ──────────────────────────────────────────────────

  async issueApprovedVisa(
    caseId: string,
    dto: IssueVisaDto,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ) {
    if (!file) {
      throw new BadRequestException('Visa document file is required.');
    }
    if (!ALLOWED_VISA_MIMES.has(file.mimetype)) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Unsupported visa document type "${file.mimetype}". Allowed: PDF, JPEG, PNG, HEIC.`,
      );
    }
    if (file.size > MAX_VISA_BYTES) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Visa document is ${file.size} bytes; maximum is ${MAX_VISA_BYTES}.`,
      );
    }
    if (!(dto.visaStartDate instanceof Date) || !(dto.visaEndDate instanceof Date)) {
      this.unlinkSilently(file.path);
      throw new BadRequestException('Visa start and end dates are required.');
    }
    if (dto.visaStartDate.getTime() > dto.visaEndDate.getTime()) {
      this.unlinkSilently(file.path);
      throw new BadRequestException('Visa start date must be on or before the end date.');
    }
    if (dto.visaEndDate.getTime() <= Date.now()) {
      this.unlinkSilently(file.path);
      throw new BadRequestException('Visa end date must be in the future.');
    }

    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        lead: { include: { contact: true } },
        visa: true,
      },
    });
    if (!existing) {
      this.unlinkSilently(file.path);
      throw new NotFoundException('Case not found');
    }
    if (existing.stage !== 'INZ_SUBMITTED') {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Case must be in INZ_SUBMITTED stage to record an outcome (current: ${existing.stage}).`,
      );
    }
    if (existing.visa) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        'Visa outcome already recorded on this case. Use the edit or revert endpoint to change it.',
      );
    }

    // Move file from /uploads/pending/ to /uploads/visas/<caseId>/.
    const destDir = path.join(VISA_FILE_DIR, caseId);
    await fs.promises.mkdir(destDir, { recursive: true });
    const ext = path.extname(file.originalname) || this.extFromMime(file.mimetype);
    const stamp = Date.now();
    const destBasename = `visa-${caseId}-${stamp}${ext}`;
    const destPath = path.join(destDir, destBasename);
    try {
      await fs.promises.rename(file.path, destPath);
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        await fs.promises.copyFile(file.path, destPath);
        this.unlinkSilently(file.path);
      } else {
        this.unlinkSilently(file.path);
        throw err;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const visa = await tx.visa.create({
        data: {
          caseId,
          outcome: 'APPROVED',
          visaStartDate: dto.visaStartDate,
          visaEndDate: dto.visaEndDate,
          visaDocumentUrl: destPath,
          visaDocumentName: file.originalname,
          visaDocumentMime: file.mimetype,
          visaDocumentSize: file.size,
          notes: dto.notes?.trim() || null,
          issuedById: actor.id,
        },
      });

      await tx.case.update({
        where: { id: caseId },
        data: { stage: 'COMPLETED' },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'VISA_ISSUED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            caseId,
            visaId: visa.id,
            visaStartDate: dto.visaStartDate.toISOString(),
            visaEndDate: dto.visaEndDate.toISOString(),
            fileName: file.originalname,
            fileSize: file.size,
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
            referenceId: visa.id,
            summaryEncrypted: this.crypto.encrypt(
              `Visa issued: ${this.fmtDate(dto.visaStartDate)} → ${this.fmtDate(dto.visaEndDate)}`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return tx.case.findUnique({
        where: { id: caseId },
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
          visa: true,
        },
      });
    });

    // Best-effort client email — never blocks the transaction.
    const clientEmail = existing.lead?.contact?.email ?? null;
    const clientName = existing.lead?.contact?.fullName ?? 'there';
    if (clientEmail) {
      this.mail
        .sendVisaIssuedToClient(
          clientEmail,
          clientName,
          caseId,
          dto.visaStartDate,
          dto.visaEndDate,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to email client on visa issuance: ${err?.message ?? err}`,
          ),
        );
    } else {
      this.logger.warn(
        `Visa issued for case ${caseId} but no client email on file.`,
      );
    }

    return updated;
  }

  // ─── Decline ───────────────────────────────────────────────────────────

  async recordDeclinedVisa(
    caseId: string,
    dto: DeclineVisaDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        lead: { include: { contact: true } },
        visa: true,
      },
    });
    if (!existing) throw new NotFoundException('Case not found');
    if (existing.stage !== 'INZ_SUBMITTED') {
      throw new BadRequestException(
        `Case must be in INZ_SUBMITTED stage to record an outcome (current: ${existing.stage}).`,
      );
    }
    if (existing.visa) {
      throw new BadRequestException(
        'Visa outcome already recorded on this case. Use the edit or revert endpoint to change it.',
      );
    }

    const reasonTrimmed = dto.declineReason.trim();
    const reasonEncrypted = this.crypto.encrypt(reasonTrimmed);
    // Hash for forensic comparison — proves "the reason at issuance"
    // matches a later quoted value without storing plaintext in audit.
    const reasonHash = crypto
      .createHash('sha256')
      .update(reasonTrimmed)
      .digest('hex');

    const updated = await this.prisma.$transaction(async (tx) => {
      const visa = await tx.visa.create({
        data: {
          caseId,
          outcome: 'DECLINED',
          declineReasonEncrypted: reasonEncrypted as never,
          notes: dto.notes?.trim() || null,
          issuedById: actor.id,
        },
      });

      await tx.case.update({
        where: { id: caseId },
        data: { stage: 'COMPLETED' },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'VISA_DECLINED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            caseId,
            visaId: visa.id,
            declineReasonHash: reasonHash,
            declineReasonLength: reasonTrimmed.length,
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
            referenceId: visa.id,
            summaryEncrypted: this.crypto.encrypt(
              `Visa declined: ${reasonTrimmed.slice(0, 80)}${reasonTrimmed.length > 80 ? '…' : ''}`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return tx.case.findUnique({
        where: { id: caseId },
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
          visa: true,
        },
      });
    });

    const clientEmail = existing.lead?.contact?.email ?? null;
    const clientName = existing.lead?.contact?.fullName ?? 'there';
    if (clientEmail) {
      this.mail
        .sendVisaDeclinedToClient(clientEmail, clientName, caseId)
        .catch((err) =>
          this.logger.error(
            `Failed to email client on visa decline: ${err?.message ?? err}`,
          ),
        );
    } else {
      this.logger.warn(
        `Visa declined for case ${caseId} but no client email on file.`,
      );
    }

    return updated;
  }

  // ─── Edit ──────────────────────────────────────────────────────────────

  async editVisaRecord(
    caseId: string,
    dto: EditVisaDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.visa.findUnique({
      where: { caseId },
    });
    if (!existing) {
      throw new NotFoundException('No visa record on this case.');
    }

    const data: Prisma.VisaUpdateInput = {};
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    if (existing.outcome === 'APPROVED') {
      if (dto.declineReason !== undefined) {
        throw new BadRequestException(
          'declineReason is not editable on an approved visa record.',
        );
      }
      if (dto.visaStartDate !== undefined) {
        if (!(dto.visaStartDate instanceof Date)) {
          throw new BadRequestException('Invalid visaStartDate.');
        }
        data.visaStartDate = dto.visaStartDate;
        previous.visaStartDate = existing.visaStartDate?.toISOString() ?? null;
        next.visaStartDate = dto.visaStartDate.toISOString();
      }
      if (dto.visaEndDate !== undefined) {
        if (!(dto.visaEndDate instanceof Date)) {
          throw new BadRequestException('Invalid visaEndDate.');
        }
        data.visaEndDate = dto.visaEndDate;
        previous.visaEndDate = existing.visaEndDate?.toISOString() ?? null;
        next.visaEndDate = dto.visaEndDate.toISOString();
      }
      // Validate post-merge dates if either changed.
      const mergedStart = (data.visaStartDate as Date | undefined) ?? existing.visaStartDate;
      const mergedEnd = (data.visaEndDate as Date | undefined) ?? existing.visaEndDate;
      if (mergedStart && mergedEnd && mergedStart.getTime() > mergedEnd.getTime()) {
        throw new BadRequestException('Visa start date must be on or before the end date.');
      }
    } else {
      // DECLINED
      if (dto.visaStartDate !== undefined || dto.visaEndDate !== undefined) {
        throw new BadRequestException(
          'visaStartDate / visaEndDate are not editable on a declined visa record.',
        );
      }
      if (dto.declineReason !== undefined) {
        const reasonTrimmed = dto.declineReason.trim();
        data.declineReasonEncrypted = this.crypto.encrypt(reasonTrimmed) as never;
        previous.declineReasonLength =
          existing.declineReasonEncrypted ? existing.declineReasonEncrypted.length : 0;
        next.declineReasonLength = reasonTrimmed.length;
        next.declineReasonHash = crypto
          .createHash('sha256')
          .update(reasonTrimmed)
          .digest('hex');
      }
    }

    if (dto.notes !== undefined) {
      data.notes = dto.notes.trim() || null;
      previous.notes = existing.notes;
      next.notes = data.notes;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No editable fields provided.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.visa.update({
        where: { caseId },
        data,
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'VISA_RECORD_EDITED',
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
            referenceId: updated.id,
            summaryEncrypted: this.crypto.encrypt(
              `Visa record edited (${Object.keys(next).join(', ')})`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return tx.case.findUnique({
        where: { id: caseId },
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
          visa: true,
        },
      });
    });
  }

  // ─── Revert ────────────────────────────────────────────────────────────

  async revertVisaRecord(
    caseId: string,
    dto: RevertVisaDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.visa.findUnique({
      where: { caseId },
    });
    if (!existing) {
      throw new NotFoundException('No visa record on this case.');
    }

    const reasonEncrypted = this.crypto.encrypt(dto.reason);
    const previousSnapshot = {
      visaId: existing.id,
      outcome: existing.outcome,
      visaStartDate: existing.visaStartDate?.toISOString() ?? null,
      visaEndDate: existing.visaEndDate?.toISOString() ?? null,
      visaDocumentName: existing.visaDocumentName,
    };

    return this.prisma.$transaction(async (tx) => {
      await tx.visa.delete({ where: { caseId } });

      await tx.case.update({
        where: { id: caseId },
        data: { stage: 'INZ_SUBMITTED' },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DELETE',
          eventType: 'VISA_RECORD_REVERTED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: previousSnapshot as Prisma.InputJsonValue,
          newValue: {
            stage: 'INZ_SUBMITTED',
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
              `Visa record reverted (was ${previousSnapshot.outcome})`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return tx.case.findUnique({
        where: { id: caseId },
        include: {
          lead: { include: { contact: true } },
          lia: { select: { id: true, name: true, email: true } },
          visa: true,
        },
      });
    });
  }

  // ─── Visa document download (signed URL) ───────────────────────────────

  async getVisaDocumentInfo(caseId: string, actor: Actor) {
    const v = await this.prisma.visa.findUnique({
      where: { caseId },
      select: {
        id: true,
        outcome: true,
        visaDocumentUrl: true,
        visaDocumentName: true,
        visaDocumentMime: true,
      },
    });
    if (!v) throw new NotFoundException('No visa record on this case.');
    if (v.outcome !== 'APPROVED' || !v.visaDocumentUrl) {
      throw new NotFoundException('No visa document attached (declined outcomes have no file).');
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'READ',
        eventType: 'VISA_DOCUMENT_DOWNLOADED',
        entityType: 'CASE',
        entityId: caseId,
        newValue: {
          visaId: v.id,
          fileName: v.visaDocumentName ?? null,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    return {
      fileUrl: v.visaDocumentUrl,
      fileName: v.visaDocumentName ?? 'visa',
      mimeType: v.visaDocumentMime ?? 'application/octet-stream',
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  // Returns the decrypted decline reason for a case if one exists.
  // Used by cases.controller to attach to the case detail response so
  // the LIA UI can render it. Returns null on cases without a visa
  // record or with an APPROVED outcome.
  async getDeclineReasonForCase(caseId: string): Promise<string | null> {
    const v = await this.prisma.visa.findUnique({
      where: { caseId },
      select: { outcome: true, declineReasonEncrypted: true },
    });
    if (!v || v.outcome !== 'DECLINED' || !v.declineReasonEncrypted) return null;
    try {
      return this.crypto.decrypt(v.declineReasonEncrypted as unknown as Buffer);
    } catch (err: any) {
      this.logger.error(
        `Failed to decrypt decline reason for case ${caseId}: ${err?.message ?? err}`,
      );
      return null;
    }
  }

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

  private fmtDate(d: Date): string {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Mirrors PR-LIA-7: Case → AdmissionApplication → VisaApplication →
  // VisaCase. Pre-visa cases skip the companion file-note write.
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
