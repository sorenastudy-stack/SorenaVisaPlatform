import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { calculateFeeBreakdown } from '../payments/fee-config';
import { hasRole } from '../auth/role.util';
import { renderInvoicePdf, InvoicePdfData } from './invoice-pdf';

// PR-TAX-INVOICE — the document, and who may have it.
//
// Generated on demand and never persisted. That is a deliberate choice, not a
// shortcut: this is ONE document per invoice whose status is printed on its
// face, so it must be true at the moment of download. A stored file would need
// invalidating on payment, on Finance verification, on any correction — and a
// stale "you owe this" PDF outliving the payment is exactly the failure the
// one-document decision exists to prevent. Rendering from the row means the
// document cannot disagree with the database.

/** Who may read anyone's invoice. Same money tier as the commission ledger. */
export const INVOICE_STAFF_ROLES = ['OWNER', 'SUPER_ADMIN', 'FINANCE'];

export interface InvoiceActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * The client's own invoice.
   *
   * Ownership is resolved from the JWT — contact.userId — and never from
   * anything the caller supplies. A foreign invoice answers NOT FOUND rather
   * than FORBIDDEN, so the response never confirms that somebody else's
   * invoice exists.
   */
  async renderForClient(userId: string | null | undefined, invoiceId: string, actor: InvoiceActor) {
    if (!userId) throw new NotFoundException('Invoice not found');
    const invoice = await this.load(invoiceId);
    if (!invoice || invoice.contact?.userId !== userId) {
      throw new NotFoundException('Invoice not found');
    }
    return this.render(invoice, actor, 'client');
  }

  /** Any invoice, for the money tier. */
  async renderForStaff(invoiceId: string, actor: InvoiceActor) {
    if (!hasRole(actor, ...INVOICE_STAFF_ROLES)) {
      throw new ForbiddenException('You are not allowed to view invoices.');
    }
    const invoice = await this.load(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.render(invoice, actor, 'staff');
  }

  private load(invoiceId: string) {
    return this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true, invoiceNumber: true, description: true, amount: true, currency: true,
        status: true, issuedAt: true, dueDate: true, paidAt: true,
        contact: { select: { userId: true, fullName: true, email: true } },
      },
    });
  }

  private async render(
    invoice: NonNullable<Awaited<ReturnType<InvoicesService['load']>>>,
    actor: InvoiceActor,
    via: 'client' | 'staff',
  ): Promise<{ buffer: Buffer; filename: string }> {
    const baseCents = Math.round(Number(invoice.amount) * 100);

    // The same function the pay screen and the Stripe charge use. The document
    // cannot state a different number from the one the client is asked for.
    const bank = calculateFeeBreakdown(baseCents, 'bank', invoice.currency);
    const card = calculateFeeBreakdown(baseCents, 'card', invoice.currency);

    const data: InvoicePdfData = {
      invoiceNumber: invoice.invoiceNumber,
      description: invoice.description,
      baseCents: bank.baseCents,
      gstCents: bank.gstCents,
      totalCents: bank.totalCents,
      cardFeeCents: card.cardFeeCents,
      cardTotalCents: card.totalCents,
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      dueDate: invoice.dueDate?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      client: {
        fullName: invoice.contact?.fullName ?? 'Client',
        email: invoice.contact?.email ?? null,
      },
      // Live, not a copy: the account an admin edits is the account this prints.
      bank: await this.settings.getBankDetails(),
    };

    const buffer = await renderInvoicePdf(data);

    // Audit — mirrors SCORECARD_CLIENT_PDF_GENERATED. Never throws out of the
    // download; a failed audit must not deny a client their own invoice.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id ?? null,
          action: 'READ',
          eventType: 'INVOICE_PDF_GENERATED',
          entityType: 'Invoice',
          entityId: invoice.id,
          newValue: { invoiceNumber: invoice.invoiceNumber, via, status: invoice.status } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    } catch (e: any) {
      this.logger.error(`[invoice-pdf] audit failed for ${invoice.id}: ${e?.message ?? e}`);
    }

    return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
  }
}
