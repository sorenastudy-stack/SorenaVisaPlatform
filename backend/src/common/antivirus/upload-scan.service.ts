import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AntivirusService, ScanVerdict } from './antivirus.service';

// PR-AV slice 2 — the ONE place an upload is scanned and refused.
//
// Slice 1 put this logic inline in the receipt handler. Twenty-one more upload
// points cannot each carry their own copy: the failure mode of copied security
// code is that one copy quietly drifts — a `catch` that swallows, a verdict
// check that treats UNAVAILABLE as fine — and nothing tells you which one.
//
// So: no caller writes try/catch around a scan, no caller re-declares the
// verdict shape (import ScanVerdict from antivirus.service), and no caller
// decides what a verdict means. Callers pass bytes and context; this either
// returns quietly or throws. There is no third outcome and no return value to
// misread — a handler that forgets to await gets an unhandled rejection, not a
// silent pass.
//
// FAIL CLOSED, exactly as slice 1: INFECTED and UNAVAILABLE both reject. The
// two are audited and messaged differently on purpose — one is their file, the
// other is our outage.

/** The multer-shaped subset actually needed. memoryStorage only — see below. */
export interface ScannableFile {
  buffer?: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

export interface ScanContext {
  /** Who uploaded. Null only where the surface genuinely has no actor. */
  userId?: string | null;
  /**
   * Audit event prefix, screaming case, no trailing underscore —
   * e.g. 'CASE_VISA_DOCUMENT_UPLOAD' → CASE_VISA_DOCUMENT_UPLOAD_REJECTED_MALWARE.
   */
  surface: string;
  entityType?: string;
  entityId?: string | null;
  /**
   * Refuse macro-capable Office formats (.docm/.xlsm/.xltm and friends).
   * Set on every surface that accepts Office documents at all. Image-only and
   * PDF-only surfaces leave it off — their own whitelist already excludes these.
   */
  blockOfficeMacros?: boolean;
}

/**
 * Macro-capable Office formats. Rejected by extension AND by mime, because
 * either one alone is trivially wrong: a .xlsm renamed to .xlsx keeps its
 * macro-enabled mime, and a spoofed mime keeps the telltale extension.
 */
const MACRO_EXTENSIONS = ['.docm', '.dotm', '.xlsm', '.xltm', '.xlam', '.pptm', '.potm', '.ppsm'];
const MACRO_MIMES = [
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-excel.addin.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
];

@Injectable()
export class UploadScanService {
  private readonly logger = new Logger(UploadScanService.name);

  constructor(
    private readonly antivirus: AntivirusService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Scan one file or a batch. Returns quietly if every file is clean; throws
   * otherwise. Call it AFTER the cheap checks (ownership, state, type) and
   * BEFORE the first write of any kind — disk, R2, database row, or queue
   * payload. Nothing downstream of this call may run on unscanned bytes.
   *
   * Batches are all-or-nothing: every file is scanned before any caller-side
   * save happens, so one bad file in a batch rejects the whole request rather
   * than leaving a half-saved set. No endpoint sends batches today; the
   * contract is here so the first one that does inherits it rather than
   * inventing it.
   */
  async scanOrReject(
    files: ScannableFile | Array<ScannableFile | undefined | null> | undefined | null,
    ctx: ScanContext,
  ): Promise<void> {
    const batch = (Array.isArray(files) ? files : [files]).filter(
      (f): f is ScannableFile => !!f,
    );
    if (batch.length === 0) return; // "no file" is the caller's own 400, not ours

    for (const file of batch) {
      if (ctx.blockOfficeMacros) this.assertNotMacroFormat(file, ctx);
    }

    // Scan EVERY file before reporting on any of them. Rejecting on the first
    // infected file would be correct but would leave a batch partly scanned;
    // scanning all of them keeps the audit record complete.
    const verdicts: Array<{ file: ScannableFile; verdict: ScanVerdict }> = [];
    for (const file of batch) {
      const buffer = file.buffer;
      if (!Buffer.isBuffer(buffer)) {
        // A file with no buffer means the route is on diskStorage (or a storage
        // engine that streams elsewhere) and these bytes were never in memory to
        // scan. That is a wiring mistake, and the safe reading of "I cannot scan
        // this" is the same as everywhere else: refuse.
        verdicts.push({
          file,
          verdict: {
            status: 'UNAVAILABLE',
            reason: 'file has no in-memory buffer — the route must use memoryStorage()',
          },
        });
        continue;
      }
      verdicts.push({ file, verdict: await this.antivirus.scanBuffer(buffer) });
    }

    const infected = verdicts.find((v) => v.verdict.status === 'INFECTED');
    if (infected && infected.verdict.status === 'INFECTED') {
      await this.audit(ctx, `${ctx.surface}_REJECTED_MALWARE`, {
        fileName:  infected.file.originalname ?? null,
        mimeType:  infected.file.mimetype ?? null,
        sizeBytes: infected.file.size ?? infected.file.buffer?.length ?? null,
        signature: infected.verdict.signature,
        batchSize: batch.length,
        outcome:   'rejected — not stored',
      });
      this.logger.warn(
        `${ctx.surface}: rejected ${infected.verdict.signature} in "${infected.file.originalname}"`,
      );
      // Deliberately says nothing technical. They learn the file was not
      // accepted; they do not learn what was detected, or that a scanner exists.
      throw new UnprocessableEntityException(
        'This file could not be uploaded. Please try a different file.',
      );
    }

    const unavailable = verdicts.find((v) => v.verdict.status === 'UNAVAILABLE');
    if (unavailable && unavailable.verdict.status === 'UNAVAILABLE') {
      await this.audit(ctx, `${ctx.surface}_REJECTED_SCANNER_UNAVAILABLE`, {
        fileName:  unavailable.file.originalname ?? null,
        reason:    unavailable.verdict.reason,
        batchSize: batch.length,
        outcome:   'rejected — not stored',
      });
      this.logger.error(`${ctx.surface}: scan unavailable — ${unavailable.verdict.reason}`);
      // Different message from the infected case on purpose: this outage is
      // ours, and telling someone their file is bad when the scanner is down
      // sends them off to re-make a file that was fine.
      throw new ServiceUnavailableException(
        'We could not process that file right now. Please try again in a few minutes.',
      );
    }
  }

  private assertNotMacroFormat(file: ScannableFile, ctx: ScanContext): void {
    const name = (file.originalname ?? '').toLowerCase();
    const mime = (file.mimetype ?? '').toLowerCase();
    const hit =
      MACRO_EXTENSIONS.some((ext) => name.endsWith(ext)) || MACRO_MIMES.includes(mime);
    if (!hit) return;

    this.logger.warn(`${ctx.surface}: refused macro-capable format "${file.originalname}"`);
    // Named plainly — unlike a detection, there is nothing to withhold here and
    // the person needs to know what to do about it.
    throw new UnsupportedMediaTypeException(
      'Macro-enabled Office files are not accepted. Please save it without macros (.docx, .xlsx) and try again.',
    );
  }

  /**
   * The audit row is written before the exception is thrown, so a refusal is on
   * the record even though nothing was stored. A failure to audit must not turn
   * a rejection into a success, so it is logged and swallowed here — this is the
   * one catch in the file, and it is around the audit, never around the scan.
   */
  private async audit(
    ctx: ScanContext,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId:     ctx.userId ?? null,
          action:     'CREATE',
          eventType,
          entityType: ctx.entityType ?? null,
          entityId:   ctx.entityId ?? null,
          newValue:   payload as Prisma.InputJsonValue,
        },
      });
    } catch (e: any) {
      this.logger.error(`${ctx.surface}: failed to audit ${eventType}: ${e?.message ?? e}`);
    }
  }
}
