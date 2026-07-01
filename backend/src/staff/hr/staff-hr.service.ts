import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { createSignedDownloadToken } from '../../common/signed-url.util';

// Same disk root as the student document uploaders (UPLOAD_DIR env, default
// ./uploads). Contracts live under ./uploads/staff-contracts/{userId}/.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

// PR-STAFF-HR (Phase 3) — staff HR self-service reads.
//
// Every method is scoped to the signed-in staff member's OWN userId — a
// caller can never read another person's contract or job description here.
// The contract PDF is served via the SAME private mechanism as student
// documents: a 5-minute signed-JWT token → GET /files/signed/:token. The
// ownership check happens HERE, before the token is minted; the token is a
// short-lived bearer capability over the file path only.
@Injectable()
export class StaffHrService {
  constructor(private readonly prisma: PrismaService) {}

  /** Metadata for the caller's own contract (or { hasContract: false }). */
  async myContract(userId: string) {
    const c = await this.prisma.staffContract.findUnique({
      where: { userId },
      select: { originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true },
    });
    if (!c) return { hasContract: false as const };
    return {
      hasContract: true as const,
      originalName: c.originalName,
      mimeType: c.mimeType,
      sizeBytes: c.sizeBytes,
      uploadedAt: c.uploadedAt,
    };
  }

  /** A short-lived signed URL to view/download the caller's OWN contract. */
  async myContractDownloadUrl(userId: string) {
    const c = await this.prisma.staffContract.findUnique({
      where: { userId },
      select: { fileUrl: true, originalName: true, mimeType: true },
    });
    if (!c) throw new NotFoundException('No contract on file');
    const token = createSignedDownloadToken({
      fileUrl: c.fileUrl,
      fileName: c.originalName,
      mimeType: c.mimeType,
    });
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  /** The caller's own admin-set job description (text may be null). */
  async myJobDescription(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { jobDescription: true, jobDescriptionSetAt: true },
    });
    return { text: u?.jobDescription ?? null, setAt: u?.jobDescriptionSetAt ?? null };
  }

  // ── ADMIN (ADMIN/OWNER tier — guarded at the controller) ───────────────
  // Manage another staff member's contract / job description. The methods
  // reuse the same read shapes; the meta/download readers are userId-scoped
  // so they work unchanged for any target user.

  private async requireUser(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new NotFoundException('Staff member not found');
  }

  async adminGetContract(userId: string) {
    await this.requireUser(userId);
    return this.myContract(userId);
  }

  async adminContractDownloadUrl(userId: string) {
    await this.requireUser(userId);
    return this.myContractDownloadUrl(userId);
  }

  async adminGetJobDescription(userId: string) {
    await this.requireUser(userId);
    return this.myJobDescription(userId);
  }

  /**
   * Store a new contract PDF (replace-on-reupload): move the uploaded file
   * into ./uploads/staff-contracts/{userId}/, upsert the one row, then delete
   * the previous file from disk (best-effort). Multer has already enforced
   * PDF-only + the 10 MB cap at the controller.
   */
  async adminUploadContract(userId: string, file: Express.Multer.File, uploaderId: string) {
    await this.requireUser(userId);

    const destDir = path.join(UPLOAD_DIR, 'staff-contracts', userId);
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(file.path));
    await fs.promises.rename(file.path, destPath);

    const previous = await this.prisma.staffContract.findUnique({
      where: { userId }, select: { fileUrl: true },
    });

    const row = await this.prisma.staffContract.upsert({
      where: { userId },
      create: {
        userId, fileUrl: destPath, originalName: file.originalname,
        mimeType: file.mimetype, sizeBytes: file.size, uploadedById: uploaderId,
      },
      update: {
        fileUrl: destPath, originalName: file.originalname, mimeType: file.mimetype,
        sizeBytes: file.size, uploadedById: uploaderId, uploadedAt: new Date(),
      },
      select: { originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true },
    });

    // Remove the superseded file (best-effort; never fails the request).
    if (previous?.fileUrl && previous.fileUrl !== destPath) {
      await fs.promises.unlink(previous.fileUrl).catch(() => undefined);
    }
    return { hasContract: true as const, ...row };
  }

  async adminDeleteContract(userId: string) {
    const existing = await this.prisma.staffContract.findUnique({
      where: { userId }, select: { fileUrl: true },
    });
    if (!existing) throw new NotFoundException('No contract on file');
    await this.prisma.staffContract.delete({ where: { userId } });
    await fs.promises.unlink(existing.fileUrl).catch(() => undefined);
    return { ok: true };
  }

  async adminSetJobDescription(userId: string, text: string | undefined, actorId: string) {
    await this.requireUser(userId);
    const clean = (text ?? '').trim();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        jobDescription: clean || null,
        jobDescriptionSetById: actorId,
        jobDescriptionSetAt: new Date(),
      },
    });
    return this.myJobDescription(userId);
  }
}
