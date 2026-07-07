import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';

// Client portal step 2 — service for the signed-in client's OWN case.
//
// Identity flows: JWT → req.user.userId → (this service) → Prisma WHERE
// clause `lead.contact.userId = <caller>`. The caller never supplies a
// case id, so cross-tenant access is impossible at the query layer
// (not relying on access checks downstream — the filter IS the gate).
//
// The response shape is built by explicit field picking, not spread.
// Forbidden fields (notes, riskLevel, raw FK ids, INZ internal-only
// columns, etc.) cannot leak through a future schema addition because
// the picker won't surface them.

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  // POST /portal/me/invoices/:invoiceId/pay-link — generate a Stripe pay
  // link for the caller's OWN unpaid invoice.
  //
  // Security: the amount is read server-side from the Invoice (the client
  // never supplies it), and the invoice's case must belong to the caller
  // via the lead.contact.userId chain. An invoice owned by another client
  // returns the SAME 404 as not-found, so we never confirm its existence.
  async createInvoicePayLink(
    userId: string,
    invoiceId: string,
  ): Promise<{ url: string }> {
    const invoice = await this.prisma.invoice.findUnique({
      where:  { id: invoiceId },
      select: { id: true, amount: true, currency: true, status: true, caseId: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (!invoice.caseId) {
      throw new BadRequestException('Invoice not payable');
    }

    // Ownership: the invoice's case must belong to the caller. A mismatch
    // returns 404 (not 403) so we never reveal the invoice exists.
    const ownedCase = await this.prisma.case.findFirst({
      where:  { id: invoice.caseId, lead: { contact: { userId } } },
      select: { id: true },
    });
    if (!ownedCase) {
      throw new NotFoundException('Invoice not found');
    }

    // Payable statuses only — mirrors buildNextSteps' SENT/OVERDUE filter.
    if (!['SENT', 'OVERDUE'].includes(invoice.status)) {
      throw new ConflictException('Invoice not payable');
    }

    // Amount is authoritative from the Invoice. This endpoint is the CARD
    // (Stripe) path, so a fixed card-processing surcharge (config
    // CARD_SURCHARGE_CENTS, default 2000 = $20) is added SERVER-SIDE — the
    // client never supplies an amount, so they cannot alter the charge. The
    // stored Invoice amount is NOT mutated: only the Stripe charge is grossed
    // up. Bank transfer / partner exchange pay the un-surcharged invoice
    // amount (they don't hit this endpoint).
    const invoiceCents = Math.round(invoice.amount.toNumber() * 100);
    if (invoiceCents <= 0) {
      throw new BadRequestException('Invoice amount is not payable');
    }
    const surchargeCents = this.cardSurchargeCents();
    const chargeCents = invoiceCents + surchargeCents;

    const { url } = await this.payments.createCustomLinkForCase(
      invoice.caseId,
      chargeCents,
      invoice.currency.toLowerCase(),
      invoiceId, // stamped into Stripe metadata for later webhook reconciliation
    );

    // Audit — the client generated a pay link for their own invoice.
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     'INVOICE_PAY_LINK_CREATED',
        eventType:  'INVOICE_PAY_LINK_CREATED',
        entityType: 'Invoice',
        entityId:   invoiceId,
        newValue:   { caseId: invoice.caseId, invoiceCents, surchargeCents, chargeCents } as Prisma.InputJsonValue,
      },
    });

    return { url };
  }

  // Fixed card-processing surcharge (config; default 2000 = $20). Added to the
  // Stripe charge only — never persisted onto the Invoice. Read in one place so
  // the pay-link (charge) and pay-options (display) always agree.
  private cardSurchargeCents(): number {
    const raw = Number(process.env.CARD_SURCHARGE_CENTS ?? 2000);
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 2000;
  }

  // GET /portal/me/invoices/:invoiceId/pay-options — read-only display data for
  // the client's pay screen. Ownership-checked exactly like the pay-link path
  // (foreign invoice → same 404). Returns the invoice (base) amount, the card
  // total (base + surcharge, derived server-side), the currency, and the
  // client's name for the bank-transfer reference. NO money-write; the Invoice
  // is not changed.
  async getInvoicePayOptions(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where:  { id: invoiceId },
      select: { id: true, invoiceNumber: true, amount: true, currency: true, status: true, caseId: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.caseId) throw new BadRequestException('Invoice not payable');

    const ownedCase = await this.prisma.case.findFirst({
      where:  { id: invoice.caseId, lead: { contact: { userId } } },
      select: { lead: { select: { contact: { select: { fullName: true } } } } },
    });
    if (!ownedCase) throw new NotFoundException('Invoice not found');

    if (!['SENT', 'OVERDUE'].includes(invoice.status)) {
      throw new ConflictException('Invoice not payable');
    }

    const baseCents = Math.round(invoice.amount.toNumber() * 100);
    const surchargeCents = this.cardSurchargeCents();
    return {
      invoiceId:     invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency:      invoice.currency.toUpperCase(),
      baseCents,                                  // bank / partner-exchange amount
      surchargeCents,
      cardCents:     baseCents + surchargeCents,  // Stripe card total
      clientName:    ownedCase.lead?.contact?.fullName ?? null,
    };
  }

  async getMyCase(userId: string) {
    const c = await this.prisma.case.findFirst({
      where:   { lead: { contact: { userId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        lia:     { select: { name: true } },
        owner:   { select: { name: true } },
        support: { select: { name: true } },
        finance: { select: { name: true } },
      },
    });
    if (!c) {
      throw new NotFoundException(
        "We couldn't find a case for your account yet. If you think this is a mistake, contact support.",
      );
    }

    // The case id is now ownership-verified (found via lead.contact.userId),
    // so the follow-up reads scope by c.id safely.
    const [nextSteps, timeline] = await Promise.all([
      this.buildNextSteps(c.id),
      this.buildTimeline(c),
    ]);

    // Explicit field picking — DO NOT spread. Every key here is on the
    // documented client-safe whitelist. The relation includes are
    // mapped to {name} only — the staff user's id, role, email, etc.
    // are dropped on the floor.
    return {
      id:                   c.id,
      stage:                c.stage,
      status:               c.status,
      createdAt:            c.createdAt,
      updatedAt:            c.updatedAt,
      assignedLia:          c.lia     ? { name: c.lia.name }     : null,
      assignedConsultant:   c.owner   ? { name: c.owner.name }   : null,
      assignedSupport:      c.support ? { name: c.support.name } : null,
      assignedFinance:      c.finance ? { name: c.finance.name } : null,
      inzApplicationNumber: c.inzApplicationNumber,
      inzSubmittedAt:       c.inzSubmittedAt,
      nextSteps,
      timeline,
    };
  }

  // GET /portal/me/payments — the caller's OWN payment history (read-only).
  //
  // Ownership: scoped by the same lead.contact.userId chain as getMyCase —
  // the caller never supplies an id. Returns a client-safe shape (no raw FK
  // ids, no verification/finance internals, no full Stripe metadata blob).
  // Empty list (not 404) when the client has no payments yet.
  async getMyPayments(userId: string) {
    const payments = await this.prisma.payment.findMany({
      where:   { lead: { contact: { userId } } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        amount: true,
        currency: true,
        status: true,
        paymentType: true,
        metadata: true,
      },
    });

    // Resolve invoice numbers for payments that reference an invoice (the
    // client pay-link path stamps metadata.invoiceId), so the label can read
    // "Invoice TEST-INV-001" instead of a generic type. Batched — no N+1.
    const invoiceIds = payments
      .map((p) => this.readInvoiceId(p.metadata))
      .filter((v): v is string => v !== null);
    const invoiceMap = new Map<string, string>();
    if (invoiceIds.length) {
      const invoices = await this.prisma.invoice.findMany({
        where:  { id: { in: invoiceIds } },
        select: { id: true, invoiceNumber: true },
      });
      for (const inv of invoices) invoiceMap.set(inv.id, inv.invoiceNumber);
    }

    return payments.map((p) => {
      const invoiceId = this.readInvoiceId(p.metadata);
      const invoiceNumber = invoiceId ? invoiceMap.get(invoiceId) : undefined;
      return {
        id:          p.id,
        createdAt:   p.createdAt.toISOString(),
        amountCents: p.amount,
        currency:    p.currency,
        status:      p.status,
        label:       this.paymentLabel(p.paymentType, invoiceNumber),
        ...(invoiceNumber ? { invoiceNumber } : {}),
      };
    });
  }

  // Safely pull a string invoiceId out of the JSON metadata blob.
  private readInvoiceId(metadata: unknown): string | null {
    if (typeof metadata !== 'object' || metadata === null) return null;
    const v = (metadata as Record<string, unknown>).invoiceId;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  // Human "what was this for" label. Invoice number wins when present;
  // otherwise map the known paymentType discriminators, defaulting to a
  // neutral "Payment" for manual/unknown/custom charges.
  private paymentLabel(paymentType: string, invoiceNumber?: string): string {
    if (invoiceNumber) return `Invoice ${invoiceNumber}`;
    switch (paymentType) {
      case 'ACCOUNT_OPENING': return 'Account opening payment';
      case 'consultation':    return 'Consultation';
      case 'subscription':    return 'Subscription';
      default:                return 'Payment';
    }
  }

  // ── "What you need to do next" — composed from existing signals, ────────
  // client-safe. Outstanding application documents (MISSING / REJECTED),
  // an unsigned engagement letter, and any due invoice. Internal fields
  // (ApplicationDocument.notes, Invoice.notes, etc.) are never surfaced.
  private async buildNextSteps(caseId: string) {
    const [docs, contract, invoices] = await Promise.all([
      this.prisma.applicationDocument.findMany({
        where:  { application: { caseId }, status: { in: ['MISSING', 'REJECTED'] } },
        select: { type: true, status: true },
      }),
      this.prisma.contract.findUnique({
        where:  { caseId },
        select: { status: true },
      }),
      this.prisma.invoice.findMany({
        where:  { caseId, status: { in: ['SENT', 'OVERDUE'] } },
        select: { id: true, invoiceNumber: true, amount: true, currency: true, dueDate: true },
      }),
    ]);

    const steps: Array<{ kind: string; label: string; detail?: string | null; invoiceId?: string }> = [];

    for (const d of docs) {
      steps.push({
        kind: 'DOCUMENT',
        label: d.status === 'REJECTED' ? `Re-upload your ${d.type}` : `Provide your ${d.type}`,
        detail: d.status === 'REJECTED' ? 'Needs attention' : null,
      });
    }

    // Awaiting the client's signature: SENT / VIEWED only. A DRAFT contract has
    // not been emailed yet, so the client has nothing to sign — prompting them
    // to "check your email" would be premature and the "Open" row would dead-end.
    // (SIGNED / DECLINED / EXPIRED need no client action here.)
    if (contract && ['SENT', 'VIEWED'].includes(contract.status)) {
      steps.push({ kind: 'CONTRACT', label: 'Sign your engagement letter', detail: null });
    }

    for (const inv of invoices) {
      steps.push({
        kind: 'INVOICE',
        label: `Pay invoice ${inv.invoiceNumber}`,
        detail: `${inv.currency} ${inv.amount.toString()}${inv.dueDate ? ` · due ${inv.dueDate.toISOString().slice(0, 10)}` : ''}`,
        invoiceId: inv.id,
      });
    }

    return steps;
  }

  // ── Case timeline — milestone-based (NOT the internal audit log). Built ─
  // from timestamps on the case's own records, so it's reliable and safe by
  // construction: no staff actor identities, no risk/notes/routing, no
  // decline reasons. Newest first.
  private async buildTimeline(c: { id: string; createdAt: Date; inzSubmittedAt: Date | null }) {
    const [contract, uploads, visa] = await Promise.all([
      this.prisma.contract.findUnique({ where: { caseId: c.id }, select: { signedAt: true } }),
      this.prisma.document.findMany({
        where:  { caseId: c.id, status: 'UPLOADED' },
        select: { originalName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.visa.findUnique({ where: { caseId: c.id }, select: { outcome: true, issuedAt: true } }),
    ]);

    const events: Array<{ date: Date; kind: string; label: string }> = [
      { date: c.createdAt, kind: 'CASE_OPENED', label: 'Case opened' },
    ];
    if (contract?.signedAt) {
      events.push({ date: contract.signedAt, kind: 'CONTRACT_SIGNED', label: 'Engagement letter signed' });
    }
    for (const u of uploads) {
      events.push({ date: u.createdAt, kind: 'DOCUMENT_UPLOADED', label: `You uploaded “${u.originalName}”` });
    }
    if (c.inzSubmittedAt) {
      events.push({ date: c.inzSubmittedAt, kind: 'INZ_SUBMITTED', label: 'Application submitted to Immigration NZ' });
    }
    if (visa) {
      events.push({
        date: visa.issuedAt,
        kind: 'VISA_DECISION',
        // Outcome is client-relevant; the decline REASON stays internal.
        label: visa.outcome === 'APPROVED' ? 'Visa approved' : 'Visa application decision recorded',
      });
    }

    return events
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((e) => ({ date: e.date, kind: e.kind, label: e.label }));
  }

  // ── Portal stage gate ───────────────────────────────────────────────────
  // STAGE_2 unlocks once BOTH the client party (CLIENT or, for a minor, the
  // GUARDIAN who signs on their behalf) AND the LIA have signed the engagement
  // letter — the DIRECTOR signature is intentionally ignored. Derived purely
  // from the caller's OWN case (lead.contact.userId → case → contract →
  // signers). "Signed" = the durable ContractSigner.signedAt IS NOT NULL, the
  // codebase's defensive convention (see payments.controller.ts). Never throws:
  // no case / no contract / not-both-signed all resolve to STAGE_1.
  async getPortalStage(userId: string): Promise<{ portalStage: 'STAGE_1' | 'STAGE_2' }> {
    const c = await this.prisma.case.findFirst({
      where:  { lead: { contact: { userId } } },
      orderBy: { createdAt: 'desc' },
      select: {
        contract: {
          select: {
            signers: {
              where:  { role: { in: ['CLIENT', 'GUARDIAN', 'LIA'] } },
              select: { role: true, signedAt: true },
            },
          },
        },
      },
    });

    const signers = c?.contract?.signers ?? [];
    const clientSigned = signers.some(
      (s) => (s.role === 'CLIENT' || s.role === 'GUARDIAN') && s.signedAt !== null,
    );
    const liaSigned = signers.some((s) => s.role === 'LIA' && s.signedAt !== null);

    return { portalStage: clientSigned && liaSigned ? 'STAGE_2' : 'STAGE_1' };
  }
}
