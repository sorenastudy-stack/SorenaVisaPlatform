import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Prisma, WixPaymentStatus, WixPaymentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

// PR-SCORECARD-4 — Wix payment webhook recorder.
//
// Strategy:
//   1. Verify the inbound shared-secret against the value stored in
//      PlatformSetting WIX_WEBHOOK_SECRET, using timingSafeEqual.
//   2. Idempotency on wixPaymentId (UNIQUE constraint backs this).
//      A retry from the Wix Automation returns the existing row
//      without writing a duplicate.
//   3. Infer paymentType from productName + amount + currency.
//   4. Best-effort match to a Lead / User via email — case-insensitive
//      lookups against contact.email + user.email. Either or both
//      may be null; they're informational only.
//   5. Persist + emit a WIX_PAYMENT_RECORDED audit row. Never touch
//      lead.leadStatus — payments are recorded, never actioned.
//
// Failed-secret attempts emit WIX_PAYMENT_WEBHOOK_REJECTED audit rows
// with the request IP + the first 8 chars of the provided secret so
// repeated probes are forensically traceable without leaking the
// real secret.

export interface WixWebhookPayload {
  paymentId?: string;
  amount?: number | string;
  currency?: string;
  productName?: string;
  customer?: {
    email?: string;
    name?: string;
    phone?: string;
  };
  bookingId?: string;
  bookingStart?: string;
  bookingEnd?: string;
  bookingLocation?: string;
  // Free-form passthrough fields are preserved in rawPayload but
  // we don't read them here.
  [key: string]: unknown;
}

export interface WixPaymentOut {
  id: string;
  wixPaymentId: string;
  wixBookingId: string | null;
  paymentType: WixPaymentType;
  amount: string;
  currency: string;
  status: WixPaymentStatus;
  customerEmail: string;
  customerName: string | null;
  customerPhone: string | null;
  bookingStart: Date | null;
  bookingEnd: Date | null;
  bookingLocation: string | null;
  matchedLeadId: string | null;
  matchedUserId: string | null;
  receivedAt: Date;
  // Only present on the detail endpoint.
  rawPayload?: Prisma.JsonValue;
  matchedLeadEmail?: string | null;
  matchedLeadName?: string | null;
  matchedUserName?: string | null;
}

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

@Injectable()
export class WixPaymentsService {
  private readonly logger = new Logger(WixPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // ─── Webhook ingest ────────────────────────────────────────────────

  async recordPayment(
    payload: WixWebhookPayload,
    requestSecret: string | null | undefined,
    requestIp: string | null,
  ): Promise<WixPaymentOut> {
    const expected = await this.settings.getInternal('WIX_WEBHOOK_SECRET');
    if (!expected || expected.length === 0) {
      // No secret configured — reject, but also write an audit row
      // so the OWNER can see the call attempt and finish setup.
      await this.writeRejectedAudit(requestIp, requestSecret);
      throw new UnauthorizedException('invalid_signature');
    }
    if (!requestSecret || typeof requestSecret !== 'string' || requestSecret.length === 0) {
      await this.writeRejectedAudit(requestIp, requestSecret);
      throw new UnauthorizedException('invalid_signature');
    }
    const expBuf = Buffer.from(expected, 'utf8');
    const reqBuf = Buffer.from(requestSecret, 'utf8');
    if (expBuf.length !== reqBuf.length || !timingSafeEqual(expBuf, reqBuf)) {
      await this.writeRejectedAudit(requestIp, requestSecret);
      throw new UnauthorizedException('invalid_signature');
    }

    const wixPaymentId = String(payload.paymentId ?? '').trim();
    if (!wixPaymentId) {
      // We accept the call (signature was valid) but can't record
      // it without an idempotency key. Bubble up a 400-friendly
      // error.
      throw new NotFoundException('paymentId missing in payload');
    }

    // Idempotency: if we already have this paymentId, return it.
    const existing = await this.prisma.wixPayment.findUnique({
      where: { wixPaymentId },
      include: {
        matchedLead: { include: { contact: { select: { email: true, fullName: true } } } },
        matchedUser: { select: { name: true } },
      },
    });
    if (existing) {
      this.logger.log(`[wix-payments] duplicate wixPaymentId=${wixPaymentId} — returning existing`);
      return this.hydrateDetail(existing);
    }

    const amount = this.parseAmount(payload.amount);
    const currency = (payload.currency ?? 'NZD').toString().toUpperCase().slice(0, 3);
    const productName = (payload.productName ?? '').toString();
    const paymentType = this.inferPaymentType(productName, amount, currency);

    const customerEmail = (payload.customer?.email ?? '').toString().trim().toLowerCase();
    const customerName  = (payload.customer?.name ?? '').toString().trim() || null;
    const customerPhone = (payload.customer?.phone ?? '').toString().trim() || null;

    // Best-effort match — case-insensitive on email.
    let matchedUserId: string | null = null;
    let matchedLeadId: string | null = null;
    if (customerEmail.length > 0) {
      const [user, contact] = await Promise.all([
        this.prisma.user.findFirst({
          where: { email: { equals: customerEmail, mode: 'insensitive' } },
          select: { id: true },
        }),
        this.prisma.contact.findFirst({
          where: { email: { equals: customerEmail, mode: 'insensitive' } },
          select: {
            id: true,
            leads: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        }),
      ]);
      matchedUserId = user?.id ?? null;
      matchedLeadId = contact?.leads?.[0]?.id ?? null;
    }

    const bookingStart = this.parseDate(payload.bookingStart);
    const bookingEnd   = this.parseDate(payload.bookingEnd);
    const bookingLocation = payload.bookingLocation
      ? String(payload.bookingLocation).slice(0, 200)
      : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wixPayment.create({
        data: {
          wixPaymentId,
          wixBookingId: payload.bookingId ? String(payload.bookingId).slice(0, 200) : null,
          paymentType,
          amount: new Prisma.Decimal(amount.toFixed(2)),
          currency,
          status: 'RECEIVED',
          customerEmail: customerEmail.slice(0, 200),
          customerName: customerName ? customerName.slice(0, 200) : null,
          customerPhone: customerPhone ? customerPhone.slice(0, 64) : null,
          bookingStart,
          bookingEnd,
          bookingLocation,
          matchedLeadId,
          matchedUserId,
          rawPayload: payload as unknown as Prisma.InputJsonValue,
        },
        include: {
          matchedLead: { include: { contact: { select: { email: true, fullName: true } } } },
          matchedUser: { select: { name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'CREATE',
          eventType: 'WIX_PAYMENT_RECORDED',
          entityType: 'WIX_PAYMENT',
          entityId: row.id,
          newValue: {
            wixPaymentId: row.wixPaymentId,
            paymentType: row.paymentType,
            amount: row.amount.toString(),
            currency: row.currency,
            matchedLeadId,
            matchedUserId,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: 'Wix Webhook',
          actorRoleSnapshot: 'SYSTEM',
        },
      });

      return row;
    });

    this.logger.log(
      `[wix-payments] recorded ${created.paymentType} ${created.amount.toString()} ${created.currency} (${maskEmail(customerEmail)})`,
    );
    return this.hydrateDetail(created);
  }

  // ─── Staff reads ───────────────────────────────────────────────────

  async listPayments(filters: {
    paymentType?: string;
    status?: string;
    customerEmail?: string;
    since?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: WixPaymentOut[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: Prisma.WixPaymentWhereInput = {};
    if (filters.paymentType && Object.values(WixPaymentType).includes(filters.paymentType as WixPaymentType)) {
      where.paymentType = filters.paymentType as WixPaymentType;
    }
    if (filters.status && Object.values(WixPaymentStatus).includes(filters.status as WixPaymentStatus)) {
      where.status = filters.status as WixPaymentStatus;
    }
    if (filters.customerEmail && filters.customerEmail.trim().length > 0) {
      where.customerEmail = {
        contains: filters.customerEmail.trim(),
        mode: 'insensitive',
      };
    }
    if (filters.since && filters.since.length > 0) {
      const d = new Date(filters.since);
      if (!Number.isNaN(d.getTime())) {
        where.receivedAt = { gte: d };
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.wixPayment.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          matchedLead: { include: { contact: { select: { email: true, fullName: true } } } },
          matchedUser: { select: { name: true } },
        },
      }),
      this.prisma.wixPayment.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.hydrateListRow(r)),
      total,
      limit,
      offset,
    };
  }

  async getPayment(id: string, actor: Actor): Promise<WixPaymentOut> {
    const row = await this.prisma.wixPayment.findUnique({
      where: { id },
      include: {
        matchedLead: { include: { contact: { select: { email: true, fullName: true } } } },
        matchedUser: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException('Payment not found');

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'READ',
        eventType: 'WIX_PAYMENT_VIEWED',
        entityType: 'WIX_PAYMENT',
        entityId: row.id,
        newValue: { wixPaymentId: row.wixPaymentId } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    return this.hydrateDetail(row);
  }

  async listPaymentsForLead(leadId: string): Promise<WixPaymentOut[]> {
    const rows = await this.prisma.wixPayment.findMany({
      where: { matchedLeadId: leadId },
      orderBy: { receivedAt: 'desc' },
      include: {
        matchedLead: { include: { contact: { select: { email: true, fullName: true } } } },
        matchedUser: { select: { name: true } },
      },
    });
    return rows.map((r) => this.hydrateListRow(r));
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private async writeRejectedAudit(ip: string | null, providedSecret: unknown): Promise<void> {
    try {
      const tail = typeof providedSecret === 'string' && providedSecret.length > 0
        ? `${providedSecret.slice(0, 8)}●●●●`
        : '(empty)';
      await this.prisma.auditLog.create({
        data: {
          userId: null,
          action: 'REJECT',
          eventType: 'WIX_PAYMENT_WEBHOOK_REJECTED',
          entityType: 'WIX_PAYMENT',
          entityId: null,
          newValue: {
            ip: ip ?? null,
            providedSecretPreview: tail,
          } as Prisma.InputJsonValue,
          ipAddress: ip ?? null,
          actorNameSnapshot: 'Wix Webhook',
          actorRoleSnapshot: 'SYSTEM',
        },
      });
    } catch (err) {
      // Audit failure must not break the rejection — log and move on.
      this.logger.error('[wix-payments] failed to write reject audit', err as Error);
    }
  }

  private inferPaymentType(productName: string, amount: number, currency: string): WixPaymentType {
    const name = productName.toLowerCase();
    if (currency === 'NZD' && Math.abs(amount - 30) < 0.01)  return 'GAP_CLOSING';
    if (currency === 'NZD' && Math.abs(amount - 150) < 0.01) return 'LIA_CONSULTATION';
    if (amount === 0 || name.includes('free'))               return 'FREE_15MIN';
    if (name.includes('gap') || name.includes('roadmap'))    return 'GAP_CLOSING';
    if (name.includes('lia') || name.includes('legal'))      return 'LIA_CONSULTATION';
    if (name.includes('consultation') || name.includes('15'))return 'FREE_15MIN';
    return 'OTHER';
  }

  private parseAmount(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
    if (typeof raw === 'string') {
      const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(n)) return Math.max(0, n);
    }
    return 0;
  }

  private parseDate(raw: unknown): Date | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private hydrateListRow(row: {
    id: string;
    wixPaymentId: string;
    wixBookingId: string | null;
    paymentType: WixPaymentType;
    amount: Prisma.Decimal;
    currency: string;
    status: WixPaymentStatus;
    customerEmail: string;
    customerName: string | null;
    customerPhone: string | null;
    bookingStart: Date | null;
    bookingEnd: Date | null;
    bookingLocation: string | null;
    matchedLeadId: string | null;
    matchedUserId: string | null;
    receivedAt: Date;
    matchedLead: { contact: { email: string | null; fullName: string } } | null;
    matchedUser: { name: string } | null;
  }): WixPaymentOut {
    return {
      id: row.id,
      wixPaymentId: row.wixPaymentId,
      wixBookingId: row.wixBookingId,
      paymentType: row.paymentType,
      amount: row.amount.toString(),
      currency: row.currency,
      status: row.status,
      customerEmail: row.customerEmail,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      bookingStart: row.bookingStart,
      bookingEnd: row.bookingEnd,
      bookingLocation: row.bookingLocation,
      matchedLeadId: row.matchedLeadId,
      matchedUserId: row.matchedUserId,
      receivedAt: row.receivedAt,
      matchedLeadEmail: row.matchedLead?.contact?.email ?? null,
      matchedLeadName: row.matchedLead?.contact?.fullName ?? null,
      matchedUserName: row.matchedUser?.name ?? null,
    };
  }

  private hydrateDetail(row: {
    id: string;
    wixPaymentId: string;
    wixBookingId: string | null;
    paymentType: WixPaymentType;
    amount: Prisma.Decimal;
    currency: string;
    status: WixPaymentStatus;
    customerEmail: string;
    customerName: string | null;
    customerPhone: string | null;
    bookingStart: Date | null;
    bookingEnd: Date | null;
    bookingLocation: string | null;
    matchedLeadId: string | null;
    matchedUserId: string | null;
    receivedAt: Date;
    rawPayload: Prisma.JsonValue;
    matchedLead: { contact: { email: string | null; fullName: string } } | null;
    matchedUser: { name: string } | null;
  }): WixPaymentOut {
    const base = this.hydrateListRow(row);
    return { ...base, rawPayload: row.rawPayload };
  }
}

// Mask the inbox half of an email for log lines. Matches the
// WixWebhooksService maskEmail.
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return `***${email.slice(at)}`;
  return `${email[0]}***${email.slice(at)}`;
}
