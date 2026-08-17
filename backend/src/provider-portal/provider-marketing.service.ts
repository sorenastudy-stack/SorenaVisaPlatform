import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UploadScanService } from '../common/antivirus/upload-scan.service';
import { EventsService } from '../events/events.service';
import { R2Service } from '../common/r2/r2.service';

// PR-PROVIDER-PORTAL — marketing material an institution sends us.
//
// Logos, brochures, prospectuses, photography, for Sorena's marketing and
// recruitment use. NOT catalogue data: nothing here is read by the matcher, the
// resolver or the Explore page.
//
// THE UPLOAD PATTERN IS NOT NEW. It is the one `setProgrammeCoverImage` already
// established: multipart through the API, a mime whitelist and a size cap
// enforced on the bytes the server actually holds, a key DERIVED SERVER-SIDE,
// and the key — never a URL — stored on the row. Downloads are short-lived
// presigned URLs, the same mechanism `documents.service` uses for client files.
//
// Multipart rather than a presigned upload URL, deliberately: a presigned PUT is
// signed before anyone has seen the bytes, so the content type is whatever the
// browser claimed. Here the server holds the file and can check it.

/** Whitelist by mime AND extension — a claimed content type is not evidence. */
const ALLOWED: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/svg+xml': ['svg'],
  'application/pdf': ['pdf'],
};
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — a prospectus, not a video

export interface MarketingActor {
  providerId: string;
  providerName: string;
  userId: string | null;
}

const VISIBLE = {
  id: true, fileName: true, contentType: true, sizeBytes: true, label: true,
  reviewStatus: true, isActive: true, createdAt: true,
} as const;

@Injectable()
export class ProviderMarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly r2: R2Service,
    // PR-AV slice 2 — the shared scan-or-reject gate.
    private readonly uploadScan: UploadScanService,
  ) {}

  async list(actor: MarketingActor) {
    const assets = await this.prisma.providerMarketingAsset.findMany({
      where: { providerId: actor.providerId, isActive: true },
      select: VISIBLE,
      orderBy: { createdAt: 'desc' },
    });
    return { assets };
  }

  async upload(
    file: { buffer?: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    label: string | undefined,
    actor: MarketingActor,
  ) {
    if (!file?.buffer) throw new BadRequestException('No file was attached.');

    const size = file.size ?? file.buffer.length;
    if (size > MAX_BYTES) {
      throw new BadRequestException(
        `That file is ${Math.round(size / 1024 / 1024)} MB. Please keep marketing files under 20 MB.`,
      );
    }

    const mime = (file.mimetype ?? '').toLowerCase();
    const exts = ALLOWED[mime];
    if (!exts) {
      throw new BadRequestException('Please upload a PDF or an image (JPG, PNG, WebP or SVG).');
    }
    // The extension has to agree with the declared type. A .pdf announcing
    // itself as image/png is not a file we want to keep, whichever one lied.
    const ext = (file.originalname ?? '').split('.').pop()?.toLowerCase() ?? '';
    if (!exts.includes(ext)) {
      throw new BadRequestException('That file’s name and type don’t match. Please re-save it and try again.');
    }

    // PR-AV slice 2 — scan before the bytes reach R2. No blockOfficeMacros: the
    // whitelist above is images and PDF only, no Office format to refuse.
    await this.uploadScan.scanOrReject(file, {
      userId:     actor.userId,
      surface:    'PROVIDER_MARKETING_UPLOAD',
      entityType: 'Provider',
      entityId:   actor.providerId,
    });

    // Derived server-side, and namespaced by institution: nothing the caller
    // sends reaches the key, so one institution cannot write into another's
    // prefix by naming a file cleverly.
    const safeExt = exts[0];
    const key = `provider-marketing/${actor.providerId}/${Date.now()}-${randomSuffix()}.${safeExt}`;
    await this.r2.putObject(key, file.buffer, mime);

    const asset = await this.prisma.providerMarketingAsset.create({
      data: {
        providerId: actor.providerId,
        r2Key: key,
        fileName: (file.originalname ?? `file.${safeExt}`).slice(0, 200),
        contentType: mime,
        sizeBytes: size,
        label: label?.trim()?.slice(0, 200) || null,
        reviewStatus: 'PENDING',
        isActive: true,
        uploadedById: actor.userId,
      },
      select: VISIBLE,
    });

    await this.audit('PROVIDER_MARKETING_ASSET_UPLOADED', asset.id, actor, {
      fileName: asset.fileName, contentType: mime, sizeBytes: size, key,
    });
    return asset;
  }

  /**
   * A short-lived presigned URL, issued per request.
   *
   * The row stores a key, so there is no long-lived link to leak and no public
   * path to guess. 60 seconds, matching the client-document download — the
   * browser opens it immediately.
   */
  async downloadUrl(id: string, actor: MarketingActor) {
    const asset = await this.prisma.providerMarketingAsset.findFirst({
      where: { id, providerId: actor.providerId, isActive: true },
      select: { id: true, r2Key: true, fileName: true },
    });
    if (!asset) throw new NotFoundException('File not found.');

    const url = await this.r2.getPresignedDownloadUrl(asset.r2Key, 60);
    await this.audit('PROVIDER_MARKETING_ASSET_DOWNLOADED', asset.id, actor, { fileName: asset.fileName });
    return { url, fileName: asset.fileName, expiresInSeconds: 60 };
  }

  /** Retire a file. Deactivated, not deleted — the same rule as everything else here. */
  async remove(id: string, actor: MarketingActor) {
    const asset = await this.prisma.providerMarketingAsset.findFirst({
      where: { id, providerId: actor.providerId },
      select: { id: true, fileName: true, isActive: true },
    });
    if (!asset) throw new NotFoundException('File not found.');
    if (!asset.isActive) return { removed: false, alreadyRemoved: true, id };

    await this.prisma.providerMarketingAsset.update({ where: { id }, data: { isActive: false } });
    await this.audit('PROVIDER_MARKETING_ASSET_REMOVED', id, actor, { fileName: asset.fileName });
    return { removed: true, id };
  }

  private audit(eventType: string, entityId: string, actor: MarketingActor, payload: Record<string, unknown>) {
    return this.events.emit(
      eventType, 'PROVIDER_MARKETING_ASSET', entityId, null, EventSource.USER, actor.userId,
      { ...payload, providerId: actor.providerId, providerName: actor.providerName },
    );
  }
}

/** Short random component so two files uploaded in the same millisecond cannot collide. */
function randomSuffix(): string {
  return require('crypto').randomBytes(6).toString('hex');
}
