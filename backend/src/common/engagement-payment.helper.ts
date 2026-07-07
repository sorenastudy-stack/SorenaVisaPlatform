import { PrismaService } from '../prisma/prisma.service';

// Piece #4 — portal payment gate.
//
// Single source of truth for "has this case's engagement fee been paid?".
// The gate is the case's engagement invoice (invoiceNumber `ENG-<caseId>`)
// reaching status PAID — the SAME end-state for all three payment methods
// (Stripe auto-reconcile, or accountant confirmation of a bank/exchange
// receipt). Nothing here writes; it only READS invoice state.
//
// FAIL SAFE: every path that cannot positively confirm PAID resolves to
// LOCKED (paid=false). No engagement invoice yet, a DB error, a missing
// case — all lock. We NEVER silently unlock.

export interface EngagementGateState {
  paid: boolean;              // ENG invoice is PAID → full access
  processing: boolean;        // receipt uploaded, awaiting confirmation (still locked)
  payInvoiceId: string | null; // the ENG invoice id to deep-link the pay screen
}

const LOCKED: EngagementGateState = { paid: false, processing: false, payInvoiceId: null };

// Resolve the engagement-gate state for a specific case id.
export async function getEngagementGateState(
  prisma: PrismaService,
  caseId: string | null | undefined,
): Promise<EngagementGateState> {
  if (!caseId) return LOCKED;
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { caseId, invoiceNumber: `ENG-${caseId}` },
      select: { id: true, status: true, receiptUploadedAt: true },
    });
    if (!invoice) return LOCKED; // no engagement fee raised yet → locked
    const paid = invoice.status === 'PAID';
    const processing =
      !paid &&
      invoice.receiptUploadedAt !== null &&
      (invoice.status === 'SENT' || invoice.status === 'OVERDUE');
    return { paid, processing, payInvoiceId: paid ? null : invoice.id };
  } catch {
    return LOCKED; // fail-safe: any error → locked
  }
}

// Boolean convenience for the document-access helper + guard.
export async function isEngagementPaid(
  prisma: PrismaService,
  caseId: string | null | undefined,
): Promise<boolean> {
  return (await getEngagementGateState(prisma, caseId)).paid;
}

// Resolve the caller's own case id from their JWT userId (lead.contact.userId
// → most-recent case). Returns null when there's no case — the guard then
// fails safe to LOCKED.
export async function resolveOwnCaseId(
  prisma: PrismaService,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const c = await prisma.case.findFirst({
      where: { lead: { contact: { userId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return c?.id ?? null;
  } catch {
    return null;
  }
}
