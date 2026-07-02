import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
        select: { invoiceNumber: true, amount: true, currency: true, dueDate: true },
      }),
    ]);

    const steps: Array<{ kind: string; label: string; detail?: string | null }> = [];

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
