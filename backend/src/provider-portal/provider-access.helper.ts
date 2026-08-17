import { PrismaService } from '../prisma/prisma.service';

// PR-PROVIDER-PORTAL slice B — who is this caller, and may they be here?
//
// Mirrors resolveAgentAccess() deliberately, including the reason it exists:
// ONE definition of the rule, read by the guard and by any status endpoint, so
// the two can never disagree. The agent portal shipped its predecessor twice —
// once in a cron, once in a filter — and one copy was wrong for twelve hours a
// day. That is the bug this shape prevents.
//
// THE PROVIDER IS RESOLVED FROM THE JWT'S USER ID, AND FROM NOTHING ELSE.
// Not a path parameter, not a query string, not a body field. That is the whole
// of the cross-tenant boundary: an institution's pricing is commercially
// sensitive, and "their own data" only means something if the caller cannot
// nominate whose data they are asking for.

export type ProviderBlockedReason =
  | 'NO_PROVIDER_RECORD'   // the login exists but is not attached to an institution
  | 'PROVIDER_INACTIVE';   // the institution is PENDING/SUSPENDED/etc.

export interface ProviderAccess {
  providerId: string | null;
  providerName: string | null;
  status: string | null;
  allowed: boolean;
  blockedReasons: ProviderBlockedReason[];
}

const DENIED = (reason: ProviderBlockedReason): ProviderAccess => ({
  providerId: null,
  providerName: null,
  status: null,
  allowed: false,
  blockedReasons: [reason],
});

export async function resolveProviderAccess(
  prisma: PrismaService,
  userId: string | null | undefined,
): Promise<ProviderAccess> {
  if (!userId) return DENIED('NO_PROVIDER_RECORD');

  // findUnique on userId — the column is @unique, so this is the 1:1 link and
  // cannot return somebody else's institution.
  const provider = await prisma.educationProvider.findUnique({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
  if (!provider) return DENIED('NO_PROVIDER_RECORD');

  const blockedReasons: ProviderBlockedReason[] = [];

  // An institution that is not ACTIVE keeps its catalogue and loses the portal.
  // Deliberately the same shape as the agent rule: status overrides everything.
  if (provider.status !== 'ACTIVE') blockedReasons.push('PROVIDER_INACTIVE');

  return {
    providerId: provider.id,
    providerName: provider.name,
    status: provider.status,
    allowed: blockedReasons.length === 0,
    blockedReasons,
  };
}
