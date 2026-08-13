import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createSignedDownloadToken } from '../../common/signed-url.util';
import { calculateFeeBreakdown } from '../../payments/fee-config';

// Piece #3 — accountant (FINANCE) "confirm payments" service.
//
// Surfaces invoices a client moved into the "processing" state in Piece #2
// (receiptUploadedAt IS NOT NULL AND status SENT) so a FINANCE user (or OWNER)
// can check the bank and CONFIRM → the invoice flips SENT→PAID, the exact same
// end-state a Stripe payment reaches via the webhook reconciliation
// (payments.controller.ts:346-382). Reused shape, different trigger + audit.
//
// This service NEVER touches the Stripe webhook, the pay-link/gross-up, or the
// client receipt-upload endpoints — it only reads their state and, on confirm,
// writes the same PAID flip the webhook writes.
@Injectable()
export class StaffPaymentsService {
  private readonly logger = new Logger(StaffPaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GET /staff/payments/pending-confirmation
  // Invoices awaiting accountant confirmation: a client uploaded a receipt
  // (processing) but the money hasn't been confirmed yet. Oldest first.
  async listPendingConfirmation() {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: 'SENT', receiptUploadedAt: { not: null } },
      orderBy: { receiptUploadedAt: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        caseId: true,
        receiptMethod: true,
        receiptUploadedAt: true,
        receiptOriginalName: true,
        contact: { select: { fullName: true } },
      },
    });

    return invoices.map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.contact?.fullName ?? '—',
      caseId: inv.caseId,
      amount: inv.amount.toString(),
      currency: inv.currency,
      amountLabel: `${inv.currency.toUpperCase()} ${inv.amount.toString()}`,
      method: inv.receiptMethod, // 'bank' | 'exchange'
      uploadedAt: inv.receiptUploadedAt,
      receiptName: inv.receiptOriginalName,
      hasReceipt: true,
    }));
  }

  // GET /staff/payments/invoices/:invoiceId/receipt
  // Mints a fresh short-lived signed URL to VIEW the uploaded receipt. The
  // FINANCE/OWNER gate is enforced at the controller; here we only verify a
  // receipt actually exists.
  async getReceiptDownloadUrl(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        receiptFileUrl: true,
        receiptOriginalName: true,
        receiptMimeType: true,
        receiptUploadedAt: true,
      },
    });
    if (!invoice || !invoice.receiptUploadedAt || !invoice.receiptFileUrl) {
      throw new NotFoundException('Receipt not found');
    }
    const token = createSignedDownloadToken({
      fileUrl: invoice.receiptFileUrl,
      fileName: invoice.receiptOriginalName ?? 'receipt',
      mimeType: invoice.receiptMimeType ?? 'application/octet-stream',
    });
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  // POST /staff/payments/invoices/:invoiceId/confirm
  // The money-write. Flips a processing invoice SENT→PAID (same end-state as a
  // Stripe payment), idempotent (already-PAID → no-op, no throw), audited.
  async confirmInvoicePayment(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        status: true,
        caseId: true,
        amount: true,
        currency: true,
        receiptMethod: true,
        receiptUploadedAt: true,
        // PR-AR-BANK-PAYMENT — Payment.leadId is required. The receipt-upload
        // path refuses an invoice with no caseId and resolves ownership through
        // case.lead.contact, so any invoice that can reach THIS method always
        // has a case, and a case always has a leadId.
        case: { select: { leadId: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Idempotent: an already-confirmed invoice is a no-op, never an error
    // (mirrors the webhook reconciliation's replay-safety).
    if (invoice.status === 'PAID') {
      return { ok: true as const, status: 'PAID' as const, alreadyPaid: true };
    }

    // Only confirm invoices that are actually in the processing state — SENT
    // with a client-uploaded receipt. Anything else (no receipt, OVERDUE
    // without receipt, CANCELLED/REFUNDED/DRAFT) is a 409, not a silent flip.
    if (invoice.status !== 'SENT' || !invoice.receiptUploadedAt) {
      throw new ConflictException(
        'Invoice is not awaiting confirmation (no uploaded receipt in the processing state).',
      );
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });
    // Invoice.amount is the PRE-GST base (Decimal dollars), as everywhere else.
    const amountCents = Math.round(Number(invoice.amount) * 100);

    // PR-AR-BANK-PAYMENT — the money record this path never wrote.
    //
    // Confirming a bank receipt flipped the invoice to PAID and stopped there.
    // Everything downstream reads Payment rows, so everything downstream was
    // blind to bank transfers — the payment method the platform RECOMMENDS:
    //
    //   • the client's Payments page showed "No payments yet" to somebody who
    //     had paid, and offered them no tax invoice to download;
    //   • the accounting dashboard counted the invoice as invoiced but never
    //     as received, under-reporting cash.
    //
    // The card path already writes one (Stripe webhook) and the staff manual
    // path already writes one. This closes the third door, in the same shape:
    // a synthetic id, the GST-inclusive total from fee-config, and
    // metadata.invoiceId — the soft link getMyPayments already resolves.
    const breakdown = calculateFeeBreakdown(amountCents, 'bank', invoice.currency);
    const leadId = invoice.case?.leadId ?? null;

    // Duplicate guard: staff may have already recorded this transfer through
    // the manual endpoint. Two rows for one transfer would double-count revenue.
    const existing = leadId
      ? await this.prisma.payment.findFirst({
          where: { metadata: { path: ['invoiceId'], equals: invoiceId } },
          select: { id: true },
        })
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: new Date() },
      });

      // Same transaction as the status flip: an invoice must never be able to
      // read PAID while its payment record is missing.
      if (leadId && !existing) {
        await tx.payment.create({
          data: {
            // `bank_` prefix, mirroring the manual path's `manual_` — cannot
            // collide with a real Stripe id (`pi_…`), so webhook idempotency
            // is untouched.
            stripePaymentIntentId: `bank_${randomUUID()}`,
            leadId,
            caseId: invoice.caseId,
            paymentType: invoice.receiptMethod === 'exchange' ? 'exchange' : 'bank_transfer',
            // The TOTAL that moved — base + GST, matching what the Stripe path
            // records (`amount_received`, likewise GST-inclusive).
            amount: breakdown.totalCents,
            currency: invoice.currency,
            gstCents: breakdown.gstCents,
            cardFeeCents: breakdown.cardFeeCents, // 0 — no card was processed
            status: 'succeeded',
            // CONFIRMED, not the PENDING default: finance is verifying at this
            // exact moment. PENDING would re-queue work that was just done.
            verificationStatus: 'CONFIRMED',
            verifiedById: userId,
            verifiedAt: new Date(),
            metadata: {
              invoiceId,
              method: invoice.receiptMethod,
              confirmedFromReceipt: true,
              actorId: userId,
              actorName: actor?.name ?? null,
              actorRole: actor?.role ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'PAYMENT_CONFIRMED_BY_FINANCE',
          eventType: 'PAYMENT_CONFIRMED_BY_FINANCE',
          entityType: 'Invoice',
          entityId: invoiceId,
          newValue: {
            status: 'PAID',
            caseId: invoice.caseId,
            amountCents,
            currency: invoice.currency,
            method: invoice.receiptMethod,
            // What was actually recorded as received.
            receivedCents: breakdown.totalCents,
            gstCents: breakdown.gstCents,
            paymentRecorded: !!(leadId && !existing),
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor?.name ?? 'FINANCE',
          actorRoleSnapshot: actor?.role ?? 'FINANCE',
        },
      });
    });

    if (existing) {
      this.logger.warn(
        `Invoice ${invoiceId} already had a linked Payment (${existing.id}) — confirmed without writing a second one.`,
      );
    } else if (!leadId) {
      // Unreachable through the supported flow (see the `case` select above);
      // logged loudly rather than throwing, because refusing to confirm real
      // money over a data-shape gap is the worse failure.
      this.logger.error(
        `Invoice ${invoiceId} confirmed but NO Payment row written — no lead could be resolved.`,
      );
    }

    this.logger.log(
      `Invoice ${invoiceId} confirmed → PAID by finance user ${userId} ` +
      `(base ${amountCents}, received ${breakdown.totalCents} ${invoice.currency})`,
    );
    return { ok: true as const, status: 'PAID' as const, alreadyPaid: false };
  }

  // POST /staff/payments/invoices/:invoiceId/reject
  // Clears the uploaded receipt so the client can re-upload (e.g. wrong file,
  // unreadable, wrong amount). Only valid while the invoice is in the
  // processing state; does NOT touch money (status stays SENT). Audited.
  async rejectReceipt(userId: string, invoiceId: string, reason?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        status: true,
        caseId: true,
        receiptFileUrl: true,
        receiptUploadedAt: true,
        receiptMethod: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'SENT' || !invoice.receiptUploadedAt) {
      throw new ConflictException(
        'Invoice is not awaiting confirmation — nothing to reject.',
      );
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });

    // Best-effort delete of the file on disk; clearing the DB fields is the
    // source of truth for "back to un-uploaded" regardless.
    if (invoice.receiptFileUrl) {
      try {
        fs.unlinkSync(path.resolve(invoice.receiptFileUrl));
      } catch {
        /* file already gone — ignore */
      }
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        receiptFileUrl: null,
        receiptOriginalName: null,
        receiptMimeType: null,
        receiptSizeBytes: null,
        receiptMethod: null,
        receiptUploadedAt: null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'RECEIPT_REJECTED_BY_FINANCE',
        eventType: 'RECEIPT_REJECTED_BY_FINANCE',
        entityType: 'Invoice',
        entityId: invoiceId,
        newValue: {
          caseId: invoice.caseId,
          method: invoice.receiptMethod,
          reason: reason ?? null,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor?.name ?? 'FINANCE',
        actorRoleSnapshot: actor?.role ?? 'FINANCE',
      },
    });
    return { ok: true as const, status: 'SENT' as const };
  }

  // ── Finance portal: dashboard + finalised ledger ─────────────────────────
  // Both read-only. The finalised ledger shows EVERY confirmed engagement
  // payment regardless of method — Stripe card (auto-reconciled by the webhook)
  // AND bank/partner-exchange (accountant-confirmed) — each labeled by method.
  // Sourced from the CURRENT invoice state (status PAID), so an invoice later
  // reset to SENT naturally drops out. FINANCE/OWNER gated at the controller.
  // READ-ONLY: never writes, never touches the confirm flow or reconciliation.

  // Every PAID engagement invoice (ENG-%), with its method derived:
  //   • receiptMethod 'bank' / 'exchange' → accountant-confirmed (client uploaded
  //     a receipt); confirmed-by = the finance user from the confirm audit.
  //   • receiptMethod null → Stripe card (auto-reconciled; no receipt ever
  //     uploaded); confirmed-by = 'Stripe (automatic)'.
  // Confirmed date = paidAt (set by both the reconciliation and the finance
  // confirm), falling back to the finance-confirm audit timestamp.
  private async confirmedRows() {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: 'PAID', invoiceNumber: { startsWith: 'ENG-' } },
      select: {
        id: true, invoiceNumber: true, amount: true, currency: true,
        caseId: true, receiptMethod: true, paidAt: true,
        contact: { select: { fullName: true } },
      },
    });
    if (invoices.length === 0) return [];

    // Finance-confirm audits give the human confirmer's name for the
    // bank/exchange rows. Keyed by invoice id, newest audit wins.
    const financeAudits = await this.prisma.auditLog.findMany({
      where: { eventType: 'PAYMENT_CONFIRMED_BY_FINANCE', entityId: { in: invoices.map((i) => i.id) } },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, actorNameSnapshot: true, createdAt: true },
    });
    const auditByInvoice = new Map<string, { actorNameSnapshot: string | null; createdAt: Date }>();
    for (const a of financeAudits) {
      if (a.entityId && !auditByInvoice.has(a.entityId)) {
        auditByInvoice.set(a.entityId, { actorNameSnapshot: a.actorNameSnapshot, createdAt: a.createdAt });
      }
    }

    return invoices.map((inv) => {
      const rm = inv.receiptMethod;
      const isReceipt = rm === 'bank' || rm === 'exchange';
      const method: 'bank' | 'exchange' | 'card' = isReceipt ? (rm as 'bank' | 'exchange') : 'card';
      const audit = auditByInvoice.get(inv.id);
      const confirmedBy = isReceipt ? (audit?.actorNameSnapshot ?? 'Finance') : 'Stripe (automatic)';
      const confirmedAt = inv.paidAt ?? audit?.createdAt ?? null;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.contact?.fullName ?? '—',
        caseId: inv.caseId,
        amount: inv.amount.toString(),
        currency: inv.currency,
        amountCents: Math.round(Number(inv.amount) * 100),
        amountLabel: `${inv.currency.toUpperCase()} ${inv.amount.toString()}`,
        method, // 'bank' | 'exchange' | 'card'
        confirmedAt,
        confirmedBy,
      };
    }).sort((x, y) => (y.confirmedAt?.getTime() ?? 0) - (x.confirmedAt?.getTime() ?? 0));
  }

  // GET /staff/finance/dashboard — read-only overview.
  async financeDashboard() {
    const [pendingCount, rows] = await Promise.all([
      this.prisma.invoice.count({ where: { status: 'SENT', receiptUploadedAt: { not: null } } }),
      this.confirmedRows(),
    ]);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const totalsByCurrency = (subset: typeof rows) => {
      const m = new Map<string, number>();
      for (const r of subset) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amountCents);
      return [...m.entries()].map(([currency, amountCents]) => ({
        currency: currency.toUpperCase(),
        amountCents,
        amountLabel: `${currency.toUpperCase()} ${(amountCents / 100).toFixed(2)}`,
      }));
    };

    const thisWeek = rows.filter((r) => r.confirmedAt !== null && r.confirmedAt >= weekAgo);
    return {
      pendingCount,
      confirmedThisWeek: { count: thisWeek.length, totals: totalsByCurrency(thisWeek) },
      confirmedAllTime: { count: rows.length, totals: totalsByCurrency(rows) },
    };
  }

  // GET /staff/finance/finalised — the confirmed-payments ledger.
  async listFinalised() {
    const rows = await this.confirmedRows();
    return rows.map((r) => ({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      clientName: r.clientName,
      caseId: r.caseId,
      amountLabel: r.amountLabel,
      method: r.method,
      confirmedAt: r.confirmedAt,
      confirmedBy: r.confirmedBy,
    }));
  }
}
