import { PrismaService } from '../prisma/prisma.service';
import { isEngagementPaid } from '../common/engagement-payment.helper';

// Documents step 3 — per-case documents access control.
//
// Mirrors the STYLE of cases/case-access.helper.ts but extended for:
//   • all 4 staff slots (liaId, ownerId, supportId, financeId), checked
//     by userId only — anyone holding a slot has standing on the case
//     regardless of their current User.role
//   • a client/lead path: a User with role LEAD or STUDENT whose id
//     matches Case → Lead → Contact.userId, allowed for read+write,
//     forbidden for delete
//
// Returns a 3-way result so the service can distinguish:
//   'case-not-found' → 404 (case doesn't exist at all)
//   'deny'           → 403 + audit log of the attempt
//   'allow'          → proceed
//
// One DB read per check (single source of truth, per spec).

export type DocumentsAccessMode = 'read' | 'write' | 'delete';
export type DocumentsAccessResult = 'allow' | 'deny' | 'case-not-found';

const ADMIN_TIER = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const CLIENT_ROLES = new Set(['LEAD', 'STUDENT']);

export async function checkCaseDocumentsAccess(
  prisma: PrismaService,
  caseId: string,
  actor: { userId: string; role: string | null | undefined },
  mode: DocumentsAccessMode,
): Promise<DocumentsAccessResult> {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      liaId: true,
      ownerId: true,
      supportId: true,
      financeId: true,
      lead: { select: { contact: { select: { userId: true } } } },
    },
  });
  if (!c) return 'case-not-found';

  // 1. Admin tier — every mode allowed.
  if (actor.role && ADMIN_TIER.has(actor.role)) return 'allow';

  // 2. Staff slot — any of the 4 slots, checked by userId only.
  //    A user holding the slot has standing on the case regardless
  //    of any subsequent role demotion.
  if (
    c.liaId === actor.userId ||
    c.ownerId === actor.userId ||
    c.supportId === actor.userId ||
    c.financeId === actor.userId
  ) {
    return 'allow';
  }

  // 3. Client — LEAD or STUDENT role whose id matches the case's
  //    Contact.userId. Read + write allowed, delete forbidden.
  const clientUserId = c.lead?.contact?.userId ?? null;
  const isClient =
    !!actor.role &&
    CLIENT_ROLES.has(actor.role) &&
    !!clientUserId &&
    clientUserId === actor.userId;
  if (isClient) {
    if (mode === 'delete') return 'deny';
    // Piece #4 — payment gate: the owning client may only access documents
    // once their engagement fee is PAID. Fail-safe (isEngagementPaid resolves
    // to false on any error / missing invoice) → 'deny'. Staff (admin tier +
    // slot holders) already returned 'allow' above and are unaffected.
    const paid = await isEngagementPaid(prisma, caseId);
    return paid ? 'allow' : 'deny';
  }

  return 'deny';
}
