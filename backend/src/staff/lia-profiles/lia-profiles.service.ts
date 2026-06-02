import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LiaProfile, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { createSignedDownloadToken } from '../../common/signed-url.util';
import { RejectLicenceDto, UpdateLicenceNumberDto } from './dto/lia-profile.dto';

// PR-DOCUSIGN-1 step 3 — LIA self-service for IAA licence credentials.
//
// Cross-tenant guard: every public method takes `userId` from the JWT
// (caller passes `req.user.userId`). Path/query/body never carry a
// userId on these self-service routes. An LIA cannot read or modify
// another LIA's profile because there's no parameter to attack.
//
// File storage mirrors PR-LIA-7 (inz-submission): multer lands in
// ./uploads/pending/ then this service fs.renames into
// ./uploads/lia-licences/<userId>/. Boot-time pending-sweep in main.ts
// covers stale uploads. Downloads via the existing /files/signed/:token
// route — JWT-signed 5-minute URLs from common/signed-url.util.
//
// Invariant: changing iaaLicenceNumber OR iaaLicenceFileUrl invalidates
// any prior verification — iaaLicenceVerifiedAt + iaaLicenceVerifiedById
// are cleared in the same transaction. The OWNER/ADMIN must re-verify.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const LIA_LICENCE_DIR = path.join(UPLOAD_DIR, 'lia-licences');
// PR-DOCUSIGN-1 (scope widening): IAA licence accepts a PDF or a
// register-page screenshot (PNG / JPG). Must mirror the controller-
// side allowlist — defence-in-depth: controller rejects at multer
// (before the file is parsed), this re-validates after.
const ALLOWED_LICENCE_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);
const MAX_LICENCE_BYTES = 10 * 1024 * 1024;

// PR-DOCUSIGN-1 (scope widening): derive a sensible filesystem
// extension from the upload's mime when the user's original filename
// has none (e.g. a phone screenshot named "IMG_1234" with no .png).
// Mirrors the inz-submission helper. Empty string for unknown mimes —
// the allowlist gate above rejects those upstream anyway.
function extFromMime(mime: string): string {
  switch (mime) {
    case 'application/pdf': return '.pdf';
    case 'image/png':       return '.png';
    case 'image/jpeg':      return '.jpg';
    default:                return '';
  }
}

export type VerificationState = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface LiaProfileResponse {
  id: string;
  userId: string;
  iaaLicenceNumber: string | null;
  iaaLicenceFileName: string | null;
  iaaLicenceFileMime: string | null;
  iaaLicenceSizeBytes: number | null;
  iaaLicenceUploadedAt: Date | null;
  iaaLicenceVerifiedAt: Date | null;
  iaaLicenceVerifiedById: string | null;
  verificationState: VerificationState;
  lastRejectionReason: string | null;
  lastRejectionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class LiaProfilesService {
  private readonly logger = new Logger(LiaProfilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── E1 — GET /staff/lia-profile/me ───────────────────────────────────

  async getOwnProfile(userId: string): Promise<LiaProfileResponse> {
    const profile = await this.findOrCreateOwn(userId);

    // Most recent upload + most recent rejection — two bounded audit reads.
    const [lastUpload, lastRejection] = await Promise.all([
      this.prisma.auditLog.findFirst({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: profile.id,
          eventType: 'LIA_LICENCE_UPLOADED',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.auditLog.findFirst({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: profile.id,
          eventType: 'LIA_LICENCE_REJECTED',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, newValue: true },
      }),
    ]);

    const incomplete =
      !profile.iaaLicenceNumber || !profile.iaaLicenceFileUrl;
    const verified = profile.iaaLicenceVerifiedAt !== null;

    let verificationState: VerificationState;
    if (verified) {
      verificationState = 'VERIFIED';
    } else if (incomplete) {
      verificationState = 'PENDING';
    } else if (lastRejection) {
      verificationState = 'REJECTED';
    } else {
      verificationState = 'PENDING';
    }

    let lastRejectionReason: string | null = null;
    let lastRejectionAt: Date | null = null;
    if (verificationState === 'REJECTED' && lastRejection) {
      lastRejectionAt = lastRejection.createdAt;
      const nv = lastRejection.newValue as Prisma.JsonValue;
      if (nv && typeof nv === 'object' && !Array.isArray(nv) && 'reason' in nv) {
        const r = (nv as { reason?: unknown }).reason;
        if (typeof r === 'string') lastRejectionReason = r;
      }
    }

    return {
      id: profile.id,
      userId: profile.userId,
      iaaLicenceNumber: profile.iaaLicenceNumber,
      iaaLicenceFileName: profile.iaaLicenceFileName,
      iaaLicenceFileMime: profile.iaaLicenceFileMime,
      iaaLicenceSizeBytes: profile.iaaLicenceSizeBytes,
      iaaLicenceUploadedAt: lastUpload?.createdAt ?? null,
      iaaLicenceVerifiedAt: profile.iaaLicenceVerifiedAt,
      iaaLicenceVerifiedById: profile.iaaLicenceVerifiedById,
      verificationState,
      lastRejectionReason,
      lastRejectionAt,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  // ─── E2 — PUT /staff/lia-profile/me/licence-number ────────────────────

  async updateOwnLicenceNumber(
    userId: string,
    dto: UpdateLicenceNumberDto,
    actor: Actor,
  ) {
    const existing = await this.findOrCreateOwn(userId);
    const newNumber = dto.iaaLicenceNumber.trim();

    if (existing.iaaLicenceNumber === newNumber) {
      return { ok: true, changed: false, resetsVerification: false };
    }

    const wasVerified = existing.iaaLicenceVerifiedAt !== null;

    await this.prisma.$transaction(async (tx) => {
      await tx.liaProfile.update({
        where: { userId },
        data: {
          iaaLicenceNumber: newNumber,
          ...(wasVerified
            ? {
                iaaLicenceVerifiedAt: null,
                iaaLicenceVerifiedById: null,
              }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'LIA_LICENCE_NUMBER_SET',
          entityType: 'LIA_PROFILE',
          entityId: existing.id,
          oldValue: {
            iaaLicenceNumber: existing.iaaLicenceNumber,
          } as Prisma.InputJsonValue,
          newValue: {
            iaaLicenceNumber: newNumber,
            resetsVerification: wasVerified,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return { ok: true, changed: true, resetsVerification: wasVerified };
  }

  // ─── E3 — POST /staff/lia-profile/me/licence-file ─────────────────────

  async uploadOwnLicenceFile(
    userId: string,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ) {
    if (!file) {
      throw new BadRequestException('Licence PDF file is required.');
    }
    if (!ALLOWED_LICENCE_MIMES.has(file.mimetype)) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Only PDF is allowed.`,
      );
    }
    if (file.size > MAX_LICENCE_BYTES) {
      this.unlinkSilently(file.path);
      throw new BadRequestException(
        `Licence file is ${file.size} bytes; maximum is ${MAX_LICENCE_BYTES}.`,
      );
    }

    const existing = await this.findOrCreateOwn(userId);

    const destDir = path.join(LIA_LICENCE_DIR, userId);
    await fs.promises.mkdir(destDir, { recursive: true });
    const ext = path.extname(file.originalname) || extFromMime(file.mimetype);
    const destBasename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const destPath = path.join(destDir, destBasename);

    try {
      await fs.promises.rename(file.path, destPath);
    } catch (err: any) {
      // EXDEV — cross-device rename. Fall back to copy + unlink.
      if (err?.code === 'EXDEV') {
        await fs.promises.copyFile(file.path, destPath);
        this.unlinkSilently(file.path);
      } else {
        this.unlinkSilently(file.path);
        throw err;
      }
    }

    const priorFileUrl = existing.iaaLicenceFileUrl;
    const replacedPrior = priorFileUrl !== null;
    const wasVerified = existing.iaaLicenceVerifiedAt !== null;

    await this.prisma.$transaction(async (tx) => {
      await tx.liaProfile.update({
        where: { userId },
        data: {
          iaaLicenceFileUrl: destPath,
          iaaLicenceFileName: file.originalname,
          iaaLicenceFileMime: file.mimetype,
          iaaLicenceSizeBytes: file.size,
          ...(wasVerified
            ? {
                iaaLicenceVerifiedAt: null,
                iaaLicenceVerifiedById: null,
              }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPLOAD',
          eventType: 'LIA_LICENCE_UPLOADED',
          entityType: 'LIA_PROFILE',
          entityId: existing.id,
          newValue: {
            fileName: file.originalname,
            sizeBytes: file.size,
            mime: file.mimetype,
            replacedPrior,
            resetsVerification: wasVerified,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    // Delete the old file from disk AFTER the new one is committed.
    // Best-effort: a disk leak is preferable to losing the new file if
    // the unlink races with anything else.
    if (priorFileUrl) {
      this.unlinkSilently(priorFileUrl);
    }

    return {
      ok: true,
      fileName: file.originalname,
      sizeBytes: file.size,
      mime: file.mimetype,
      replacedPrior,
      resetsVerification: wasVerified,
    };
  }

  // ─── E4 — GET /staff/lia-profile/me/licence-file/download-url ─────────

  async getOwnLicenceDownloadUrl(userId: string) {
    const profile = await this.prisma.liaProfile.findUnique({
      where: { userId },
      select: {
        iaaLicenceFileUrl: true,
        iaaLicenceFileName: true,
        iaaLicenceFileMime: true,
      },
    });
    if (!profile?.iaaLicenceFileUrl) {
      throw new NotFoundException('No licence file uploaded yet.');
    }
    const token = createSignedDownloadToken({
      fileUrl: profile.iaaLicenceFileUrl,
      // PR-DOCUSIGN-1 (scope widening): fallback was hardcoded PDF
      // when the licence accepted PDF only. With PNG/JPG now valid
      // too, fall back to a format-agnostic name + octet-stream so a
      // degenerate row (file URL set but metadata null — shouldn't
      // happen) doesn't mis-serve an image as a PDF.
      fileName: profile.iaaLicenceFileName ?? 'lia-licence',
      mimeType: profile.iaaLicenceFileMime ?? 'application/octet-stream',
    });
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  // ═══ VERIFIER-SIDE (OWNER / ADMIN / SUPER_ADMIN) ══════════════════════

  // ─── E5 — GET /staff/lia-profiles/pending-verification ────────────────

  async listPendingVerification() {
    // Defensive `user.role === 'LIA'` clause: if a non-LIA account ever
    // ended up with a lia_profile row (e.g. via a misconfigured state
    // change), it should not show up in the verification queue.
    const rows = await this.prisma.liaProfile.findMany({
      where: {
        iaaLicenceNumber: { not: null },
        iaaLicenceFileUrl: { not: null },
        iaaLicenceVerifiedAt: null,
        user: { role: 'LIA' },
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (rows.length === 0) return [];

    const profileIds = rows.map((r) => r.id);

    // Two bounded aggregate queries → 3 round-trips total regardless of
    // N, avoiding the per-row N+1.
    const [rejectionCounts, uploadMaxima] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['entityId'],
        where: {
          entityType: 'LIA_PROFILE',
          eventType: 'LIA_LICENCE_REJECTED',
          entityId: { in: profileIds },
        },
        _count: { _all: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['entityId'],
        where: {
          entityType: 'LIA_PROFILE',
          eventType: 'LIA_LICENCE_UPLOADED',
          entityId: { in: profileIds },
        },
        _max: { createdAt: true },
      }),
    ]);

    const rejectionMap = new Map<string, number>();
    for (const r of rejectionCounts) {
      if (r.entityId) rejectionMap.set(r.entityId, r._count._all);
    }
    const uploadedAtMap = new Map<string, Date | null>();
    for (const u of uploadMaxima) {
      if (u.entityId) uploadedAtMap.set(u.entityId, u._max.createdAt ?? null);
    }

    return rows.map((r) => ({
      profileId: r.id,
      userId: r.user.id,
      userName: r.user.name,
      userEmail: r.user.email,
      iaaLicenceNumber: r.iaaLicenceNumber,
      iaaLicenceFileName: r.iaaLicenceFileName,
      iaaLicenceFileMime: r.iaaLicenceFileMime,
      iaaLicenceSizeBytes: r.iaaLicenceSizeBytes,
      uploadedAt: uploadedAtMap.get(r.id) ?? r.updatedAt,
      priorRejections: rejectionMap.get(r.id) ?? 0,
    }));
  }

  // ─── E6 — GET /staff/lia-profiles/:userId/licence-file/download-url ───

  async getLicenceDownloadUrlForVerifier(targetUserId: string, actor: Actor) {
    const profile = await this.prisma.liaProfile.findUnique({
      where: { userId: targetUserId },
      select: {
        id: true,
        iaaLicenceFileUrl: true,
        iaaLicenceFileName: true,
        iaaLicenceFileMime: true,
        user: { select: { name: true } },
      },
    });
    if (!profile?.iaaLicenceFileUrl) {
      throw new NotFoundException('No licence file on that profile.');
    }

    // Audit BEFORE returning the URL — every verifier-side download
    // leaves a row. Self-downloads (LIA viewing own cert via E4) are
    // NOT audited; this endpoint is the cross-tenant access trail.
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'DOWNLOAD',
        eventType: 'LIA_LICENCE_VIEWED_BY_VERIFIER',
        entityType: 'LIA_PROFILE',
        entityId: profile.id,
        newValue: {
          liaUserId: targetUserId,
          liaName: profile.user.name,
          fileName: profile.iaaLicenceFileName,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    const token = createSignedDownloadToken({
      fileUrl: profile.iaaLicenceFileUrl,
      // PR-DOCUSIGN-1 (scope widening): fallback was hardcoded PDF
      // when the licence accepted PDF only. With PNG/JPG now valid
      // too, fall back to a format-agnostic name + octet-stream so a
      // degenerate row (file URL set but metadata null — shouldn't
      // happen) doesn't mis-serve an image as a PDF.
      fileName: profile.iaaLicenceFileName ?? 'lia-licence',
      mimeType: profile.iaaLicenceFileMime ?? 'application/octet-stream',
    });
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  // ─── E7 — POST /staff/lia-profiles/:userId/verify ─────────────────────

  async verifyProfile(targetUserId: string, actor: Actor) {
    // Self-guard: an OWNER/ADMIN cannot verify their own LiaProfile,
    // even if they also hold the LIA role. Edge case but explicit.
    if (actor.id === targetUserId) {
      throw new ForbiddenException(
        'You cannot verify your own LIA profile. Ask another OWNER/ADMIN.',
      );
    }

    const existing = await this.prisma.liaProfile.findUnique({
      where: { userId: targetUserId },
      include: { user: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException('Profile not found.');
    if (!existing.iaaLicenceNumber || !existing.iaaLicenceFileUrl) {
      throw new BadRequestException(
        'Cannot verify an incomplete profile — both licence number and file are required.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.liaProfile.update({
        where: { userId: targetUserId },
        data: {
          iaaLicenceVerifiedAt: new Date(),
          iaaLicenceVerifiedById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'VERIFY',
          eventType: 'LIA_LICENCE_VERIFIED',
          entityType: 'LIA_PROFILE',
          entityId: existing.id,
          newValue: {
            liaUserId: targetUserId,
            liaName: existing.user.name,
            iaaLicenceNumber: existing.iaaLicenceNumber,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return {
      ok: true,
      verifiedAt: updated.iaaLicenceVerifiedAt,
      verifiedById: updated.iaaLicenceVerifiedById,
    };
  }

  // ─── E8 — POST /staff/lia-profiles/:userId/reject ─────────────────────

  async rejectProfile(
    targetUserId: string,
    dto: RejectLicenceDto,
    actor: Actor,
  ) {
    if (actor.id === targetUserId) {
      throw new ForbiddenException(
        'You cannot reject your own LIA profile. Ask another OWNER/ADMIN.',
      );
    }

    const existing = await this.prisma.liaProfile.findUnique({
      where: { userId: targetUserId },
      include: { user: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundException('Profile not found.');

    // Per the approved design (D3): reject does NOT touch the LiaProfile
    // row. The audit log is the source of truth for rejection state.
    // The LIA re-uploads when they have corrections; until then, the
    // OWNER's reason is what they see on their own profile.
    const reason = dto.reason.trim();
    const created = await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'REJECT',
        eventType: 'LIA_LICENCE_REJECTED',
        entityType: 'LIA_PROFILE',
        entityId: existing.id,
        newValue: {
          liaUserId: targetUserId,
          liaName: existing.user.name,
          iaaLicenceNumber: existing.iaaLicenceNumber,
          reason,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    return { ok: true, rejectedAt: created.createdAt };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  // Lazy-create on first read. Keeps the schema in "row exists" shape
  // from the moment a LIA first touches their profile, so subsequent
  // writes use `update` not `upsert`.
  private async findOrCreateOwn(userId: string): Promise<LiaProfile> {
    const existing = await this.prisma.liaProfile.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.liaProfile.create({
      data: { userId },
    });
  }

  private unlinkSilently(p: string | undefined) {
    if (!p) return;
    fs.promises.unlink(p).catch((err) => {
      // Best-effort cleanup: a leaked file on disk is preferable to
      // failing the request that already succeeded. Log so a future
      // disk-usage anomaly is traceable.
      this.logger.warn(`unlink failed for ${p}: ${err?.message ?? err}`);
    });
  }
}
