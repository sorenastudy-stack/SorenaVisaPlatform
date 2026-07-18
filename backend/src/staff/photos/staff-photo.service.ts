import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../../common/r2/r2.service';

// PR-STAFF-PHOTOS — staff profile photos on Cloudflare R2 (the persistent,
// already-wired pattern used by the documents module; NOT the ephemeral local
// disk the LIA-licence / HR-contract uploads use).
//
// The server receives the multipart bytes, validates type + size on the ACTUAL
// bytes, uploads to R2 with a per-user key, and stores only the key on User.
// Reads derive a short-lived presigned download URL. Self-upload takes the
// userId from the JWT (never a param); admin upload is role-gated by the
// controller and audit-logged here.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DOWNLOAD_URL_TTL_SECONDS = 3600; // 1h — long enough for a page session

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png':  return '.png';
    case 'image/webp': return '.webp';
    default:           return '';
  }
}

@Injectable()
export class StaffPhotoService {
  private readonly logger = new Logger(StaffPhotoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  // Presigned GET url for a stored key (null when there's no photo). Signing is
  // local (no network), so mapping this over a list of staff is cheap.
  async presignedUrl(photoKey: string | null | undefined): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2.getPresignedDownloadUrl(photoKey, DOWNLOAD_URL_TTL_SECONDS);
    } catch (err: any) {
      this.logger.warn(`presign failed for ${photoKey}: ${err?.message ?? err}`);
      return null;
    }
  }

  // ── Self-service (own JWT only) ──────────────────────────────────────────
  async uploadOwnPhoto(userId: string, file: Express.Multer.File | undefined) {
    return this.store(userId, file);
  }

  async deleteOwnPhoto(userId: string) {
    return this.clear(userId);
  }

  // ── Admin (role-gated by the controller) — audited ───────────────────────
  async uploadPhotoForUser(targetUserId: string, file: Express.Multer.File | undefined, actor: Actor) {
    const res = await this.store(targetUserId, file);
    await this.auditAdmin('STAFF_PHOTO_UPDATED_BY_ADMIN', targetUserId, actor);
    return res;
  }

  async deletePhotoForUser(targetUserId: string, actor: Actor) {
    const res = await this.clear(targetUserId);
    await this.auditAdmin('STAFF_PHOTO_REMOVED_BY_ADMIN', targetUserId, actor);
    return res;
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private async store(userId: string, file: Express.Multer.File | undefined) {
    if (!file || !file.buffer) {
      throw new BadRequestException('An image file is required.');
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image type. Allowed: JPG, PNG, or WebP.');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`Image is too large (max ${MAX_BYTES / (1024 * 1024)} MB).`);
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, photoKey: true },
    });
    if (!existing) throw new NotFoundException('Staff member not found.');

    const key = `staff-photos/${userId}/${randomBytes(16).toString('hex')}${extFromMime(file.mimetype)}`;
    await this.r2.putObject(key, file.buffer, file.mimetype);

    await this.prisma.user.update({ where: { id: userId }, data: { photoKey: key } });

    // Best-effort cleanup of the previous object (a leaked object is preferable
    // to failing a request that already committed the new key).
    if (existing.photoKey && existing.photoKey !== key) {
      this.r2.deleteObject(existing.photoKey).catch((err) =>
        this.logger.warn(`old photo delete failed for ${existing.photoKey}: ${err?.message ?? err}`),
      );
    }

    return { ok: true, photoUrl: await this.presignedUrl(key) };
  }

  private async clear(userId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, photoKey: true },
    });
    if (!existing) throw new NotFoundException('Staff member not found.');
    if (existing.photoKey) {
      await this.prisma.user.update({ where: { id: userId }, data: { photoKey: null } });
      this.r2.deleteObject(existing.photoKey).catch((err) =>
        this.logger.warn(`photo delete failed for ${existing.photoKey}: ${err?.message ?? err}`),
      );
    }
    return { ok: true, photoUrl: null };
  }

  private async auditAdmin(eventType: string, targetUserId: string, actor: Actor) {
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id ?? null,
        action: eventType.includes('REMOVED') ? 'DELETE' : 'UPLOAD',
        eventType,
        entityType: 'User',
        entityId: targetUserId,
        newValue: { targetUserId } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });
  }
}
