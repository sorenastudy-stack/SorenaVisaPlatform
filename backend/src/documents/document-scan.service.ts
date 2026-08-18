import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentScanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../common/r2/r2.service';
import { AntivirusService } from '../common/antivirus/antivirus.service';

// PR-AV slice 3 — scanning the one upload path that cannot be scanned in-handler.
//
// ⚠️ READ THIS BEFORE ASSUMING THIS IS EQUIVALENT TO EVERY OTHER UPLOAD POINT.
//
// Every other route on this platform scans BEFORE the file is stored: multer
// holds the bytes in memory, UploadScanService refuses, and an infected file is
// never written anywhere. Nothing to clean up, because nothing was created.
//
// Case documents are different, structurally and unavoidably. The browser PUTs
// straight to Cloudflare R2 with a presigned URL — the backend never sees the
// bytes, so there is no handler in which to refuse them. By the time we can
// scan, the object EXISTS IN STORAGE. This job fetches it, scans it, and
// deletes it if infected.
//
// So the guarantee here is weaker and must not be described as if it weren't:
//
//   every other route  →  an infected file is NEVER stored
//   case documents     →  an infected file IS briefly stored, then deleted
//
// That window is bounded (one poll tick, 15s, plus fetch+scan time) and the
// object is unreachable throughout: the bucket is private, no public domain is
// bound to it, and the ONLY way to obtain a download URL is getDownloadUrl,
// which refuses anything not CLEAN. The exposure is "bytes at rest in a private
// bucket for a few seconds", not "a malicious file anyone could fetch".
//
// This is an accepted, understood consequence of presigned-direct upload — not
// a bug, and not something to quietly treat as identical to the rest.

/** How many documents one tick will scan. Keeps a backlog from stalling a tick. */
const BATCH = 10;
/** Past this many failed attempts, say so loudly instead of retrying in silence. */
const LOUD_AFTER_ATTEMPTS = 10;

@Injectable()
export class DocumentScanService {
  private readonly logger = new Logger(DocumentScanService.name);
  /** Guards against a slow tick overlapping the next one. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly antivirus: AntivirusService,
  ) {}

  // Every 15 seconds. ScheduleModule.forRoot() is already registered app-wide
  // (visa-expiry.module), so this is discovered without re-registering it.
  @Cron('*/15 * * * * *', { name: 'documentScanSweep' })
  async sweep(): Promise<void> {
    if (this.running) return; // previous tick still working — skip, don't queue
    this.running = true;
    try {
      await this.scanPending();
    } catch (e: any) {
      this.logger.error(`document scan sweep failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * One pass: take a batch of documents awaiting a verdict and resolve each.
   * Exposed (not private) so a test or an operator script can force a pass
   * without waiting on the scheduler.
   */
  async scanPending(): Promise<{ scanned: number; clean: number; infected: number; errored: number }> {
    const pending = await this.prisma.document.findMany({
      where: {
        // SCAN_ERROR rows are retried on later ticks; that is the whole retry
        // mechanism, and it needs no queue.
        scanStatus: { in: [DocumentScanStatus.PENDING_SCAN, DocumentScanStatus.SCAN_ERROR] },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, r2Key: true, originalName: true, mimeType: true, sizeBytes: true, caseId: true, uploaderId: true, scanAttempts: true },
    });
    if (pending.length === 0) return { scanned: 0, clean: 0, infected: 0, errored: 0 };

    let clean = 0, infected = 0, errored = 0;
    for (const doc of pending) {
      const outcome = await this.scanOne(doc);
      if (outcome === 'CLEAN') clean++;
      else if (outcome === 'INFECTED') infected++;
      else errored++;
    }

    this.logger.log(`document scan: ${pending.length} examined — ${clean} clean, ${infected} infected, ${errored} deferred`);
    return { scanned: pending.length, clean, infected, errored };
  }

  private async scanOne(doc: {
    id: string; r2Key: string; originalName: string; mimeType: string;
    sizeBytes: number; caseId: string; uploaderId: string; scanAttempts: number;
  }): Promise<'CLEAN' | 'INFECTED' | 'ERROR'> {
    const attempts = doc.scanAttempts + 1;

    let bytes: Buffer | null;
    try {
      bytes = await this.r2.getObjectBytes(doc.r2Key);
    } catch (e: any) {
      return this.defer(doc, attempts, `could not fetch from storage: ${e?.message ?? e}`);
    }

    if (bytes === null) {
      // The object is not there. Nothing to scan and nothing to delete — most
      // likely a PENDING row whose upload never completed, or one already
      // cleaned up. Marking it SCAN_ERROR would retry forever against an object
      // that will never exist, so it is recorded as errored ONCE, loudly, and
      // parked with the attempt count already past the loud threshold.
      await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          scanStatus: DocumentScanStatus.SCAN_ERROR,
          scanAttempts: LOUD_AFTER_ATTEMPTS + 1,
          scanCheckedAt: new Date(),
        },
      });
      this.logger.warn(`document ${doc.id}: object missing from storage — parked as SCAN_ERROR, will not retry`);
      await this.audit(doc, 'CASE_DOCUMENT_SCAN_ERROR', { reason: 'object missing from storage', attempts });
      return 'ERROR';
    }

    // The SAME scanner every other upload point uses. No second implementation.
    const verdict = await this.antivirus.scanBuffer(bytes);

    if (verdict.status === 'CLEAN') {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { scanStatus: DocumentScanStatus.CLEAN, scanAttempts: attempts, scanCheckedAt: new Date() },
      });
      return 'CLEAN';
    }

    if (verdict.status === 'INFECTED') {
      // Delete FIRST, then record. If the delete fails we want the row still
      // marked INFECTED (so the download gate refuses it) and the failure
      // visible, rather than a clean-looking row over a live object.
      let deleted = true;
      try {
        await this.r2.deleteObject(doc.r2Key);
      } catch (e: any) {
        deleted = false;
        this.logger.error(`document ${doc.id}: INFECTED but delete from storage FAILED: ${e?.message ?? e}`);
      }

      await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          scanStatus: DocumentScanStatus.INFECTED,
          scanSignature: verdict.signature,
          scanAttempts: attempts,
          scanCheckedAt: new Date(),
        },
      });

      this.logger.warn(`document ${doc.id}: ${verdict.signature} — object ${deleted ? 'deleted' : 'DELETE FAILED'}`);
      await this.audit(doc, 'CASE_DOCUMENT_REJECTED_MALWARE', {
        signature: verdict.signature,
        // Deliberately not "rejected — not stored": on this path it WAS stored.
        // Saying otherwise would make the audit trail read as though this route
        // gave the same guarantee as the in-handler ones. It does not.
        outcome: deleted
          ? 'stored briefly via presigned upload, then deleted'
          : 'stored via presigned upload — DELETE FAILED, object may remain',
        attempts,
      });
      return 'INFECTED';
    }

    // UNAVAILABLE — the scanner could not answer. Retry next tick.
    return this.defer(doc, attempts, verdict.reason);
  }

  private async defer(
    doc: { id: string; r2Key: string; originalName: string; mimeType: string; sizeBytes: number; caseId: string; uploaderId: string },
    attempts: number,
    reason: string,
  ): Promise<'ERROR'> {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { scanStatus: DocumentScanStatus.SCAN_ERROR, scanAttempts: attempts, scanCheckedAt: new Date() },
    });

    if (attempts === LOUD_AFTER_ATTEMPTS) {
      // Exactly once, at the threshold — not every tick forever after, which
      // would bury the signal it exists to raise. A document stuck here is
      // unreachable (the download gate refuses non-CLEAN), so this is a "someone
      // should look" not a "something is exposed".
      this.logger.warn(
        `document ${doc.id} has failed to scan ${attempts} times and is still unresolved — ${reason}`,
      );
      await this.audit(doc, 'CASE_DOCUMENT_SCAN_STUCK', { reason, attempts });
    }
    return 'ERROR';
  }

  private async audit(
    doc: { id: string; caseId: string; uploaderId: string; originalName: string; mimeType: string; sizeBytes: number },
    eventType: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: doc.uploaderId,
          action: 'CREATE',
          eventType,
          entityType: 'DOCUMENT',
          entityId: doc.id,
          newValue: {
            caseId: doc.caseId,
            fileName: doc.originalName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            ...extra,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (e: any) {
      // Same rule as UploadScanService: failing to audit must never change the
      // verdict that was already applied.
      this.logger.error(`document ${doc.id}: failed to audit ${eventType}: ${e?.message ?? e}`);
    }
  }
}
