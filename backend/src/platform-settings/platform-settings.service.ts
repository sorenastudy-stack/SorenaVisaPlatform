import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-SCORECARD-4 — Platform settings service.
//
// Two-tier value handling:
//   * Booking URLs   — plaintext, returned verbatim from list / get.
//   * Webhook secret — plaintext stored, but ALWAYS masked on read.
//                       The plaintext is exposed exactly once, on
//                       regenerate, so the OWNER can copy it to Wix.
//
// `getInternal()` is the back-door used by the Wix webhook controller
// to compare the inbound `X-Sorena-Webhook-Secret` against the real
// stored value. Nothing else in the codebase should ever call this —
// route the controllers through `get()` so the masking stays applied.
//
// Audit rows are written for every mutation. `value` is logged
// verbatim for booking-URL settings (URLs are not sensitive) and
// masked for the webhook secret.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface PlatformSettingOut {
  id: string;
  key: string;
  value: string;
  description: string | null;
  category: string;
  updatedAt: Date;
  createdAt: Date;
  updatedById: string;
  updatedByName: string | null;
}

// Keys whose value must NEVER be returned plaintext through the
// list / get API. The Wix webhook secret is the only one today; add
// more keys here as the integration surface grows.
const MASKED_KEYS = new Set<string>(['WIX_WEBHOOK_SECRET']);

// Keys whose value must validate as a URL on update.
const URL_KEYS = new Set<string>([
  'BOOKING_URL_FREE_15MIN',
  'BOOKING_URL_GAP_CLOSING',
  'BOOKING_URL_LIA_CONSULTATION',
]);

const URL_REGEX = /^https?:\/\/.+/i;
const MASK = '●●●●●●●● (hidden)';

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Reads ─────────────────────────────────────────────────────────

  async list(category?: string): Promise<PlatformSettingOut[]> {
    const where: Prisma.PlatformSettingWhereInput = {};
    if (category && category.trim().length > 0) {
      where.category = category.trim();
    }
    const rows = await this.prisma.platformSetting.findMany({
      where,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    return rows.map((r) => this.hydrate(r));
  }

  async get(key: string): Promise<PlatformSettingOut> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException(`Setting ${key} not found`);
    return this.hydrate(row);
  }

  // Internal — returns the raw plaintext value of any setting. Used
  // by the webhook controller to compare against the inbound header.
  // NEVER expose through a controller.
  async getInternal(key: string): Promise<string | null> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  // Returns the three booking URLs in a stable shape for the
  // frontend's `getBookingUrls()` consumer. Booking URLs are not
  // sensitive, so plaintext values are returned.
  async getBookingUrls(): Promise<{
    FREE_15MIN: string;
    GAP_CLOSING_PAYMENT: string;
    LIA_CONSULTATION: string;
  }> {
    const rows = await this.prisma.platformSetting.findMany({
      where: {
        key: {
          in: [
            'BOOKING_URL_FREE_15MIN',
            'BOOKING_URL_GAP_CLOSING',
            'BOOKING_URL_LIA_CONSULTATION',
          ],
        },
      },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      FREE_15MIN: map.get('BOOKING_URL_FREE_15MIN')
        ?? 'https://www.sorenavisa.com/book-free-consultation',
      GAP_CLOSING_PAYMENT: map.get('BOOKING_URL_GAP_CLOSING')
        ?? 'https://www.sorenavisa.com/gap-closing-session-payment',
      LIA_CONSULTATION: map.get('BOOKING_URL_LIA_CONSULTATION')
        ?? 'https://www.sorenavisa.com/lia-consultation-payment',
    };
  }

  // ─── Mutations ─────────────────────────────────────────────────────

  async update(
    key: string,
    value: string,
    actor: Actor,
  ): Promise<PlatformSettingOut> {
    const existing = await this.prisma.platformSetting.findUnique({
      where: { key },
    });
    if (!existing) throw new NotFoundException(`Setting ${key} not found`);

    // Webhook secret cannot be set via this endpoint — secrets are
    // auto-generated via `regenerateWebhookSecret()`.
    if (MASKED_KEYS.has(key)) {
      throw new BadRequestException(
        `Secret ${key} cannot be edited directly. Use the regenerate endpoint.`,
      );
    }

    if (URL_KEYS.has(key)) {
      if (!URL_REGEX.test(value.trim())) {
        throw new BadRequestException(
          'value must be an http:// or https:// URL.',
        );
      }
    }

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
      throw new BadRequestException('value must be 1-2000 characters');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformSetting.update({
        where: { key },
        data: { value: trimmed, updatedById: actor.id },
        include: { updatedBy: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'PLATFORM_SETTING_UPDATED',
          entityType: 'PLATFORM_SETTING',
          entityId: updated.id,
          newValue: {
            key,
            // Booking URLs are non-sensitive — log the plaintext URL so
            // the activity feed shows the change clearly. The masking
            // branch is here for future non-URL plaintext keys.
            value: URL_KEYS.has(key) ? trimmed : MASK,
            category: updated.category,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return updated;
    });

    return this.hydrate(row);
  }

  // Regenerate the Wix webhook secret. Returns the new plaintext
  // ONCE — every subsequent read masks it. The OWNER must copy it
  // to Wix Automations immediately, otherwise webhook calls will
  // start being rejected.
  async regenerateWebhookSecret(actor: Actor): Promise<{
    key: string;
    plaintextValue: string;
    updatedAt: Date;
  }> {
    const newSecret = randomBytes(32).toString('hex');

    const updated = await this.prisma.$transaction(async (tx) => {
      // Upsert in case the seed didn't run on a fresh deployment.
      const row = await tx.platformSetting.upsert({
        where: { key: 'WIX_WEBHOOK_SECRET' },
        update: { value: newSecret, updatedById: actor.id },
        create: {
          key: 'WIX_WEBHOOK_SECRET',
          value: newSecret,
          category: 'wix_integration',
          description:
            'Shared secret for verifying Wix Automation webhook calls. Rotate by regenerating this value and updating the Wix Automation header.',
          updatedById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'WIX_WEBHOOK_SECRET_REGENERATED',
          entityType: 'PLATFORM_SETTING',
          entityId: row.id,
          newValue: {
            key: 'WIX_WEBHOOK_SECRET',
            value: MASK,
            category: 'wix_integration',
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return row;
    });

    this.logger.warn(
      `[platform-settings] WIX_WEBHOOK_SECRET regenerated by ${actor.id} — Wix Automation header must be updated`,
    );

    return {
      key: 'WIX_WEBHOOK_SECRET',
      plaintextValue: newSecret,
      updatedAt: updated.updatedAt,
    };
  }

  // ─── Hydration ─────────────────────────────────────────────────────

  private hydrate(row: {
    id: string;
    key: string;
    value: string;
    description: string | null;
    category: string;
    updatedAt: Date;
    createdAt: Date;
    updatedById: string;
    updatedBy: { id: string; name: string } | null;
  }): PlatformSettingOut {
    return {
      id: row.id,
      key: row.key,
      value: MASKED_KEYS.has(row.key) ? MASK : row.value,
      description: row.description,
      category: row.category,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      updatedById: row.updatedById,
      updatedByName: row.updatedBy?.name ?? null,
    };
  }
}
