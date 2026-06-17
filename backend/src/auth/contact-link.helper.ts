import { PrismaService } from '../prisma/prisma.service';

/**
 * Client portal step 1 — link a Contact row to a User row by email at
 * sign-in, when (and only when) the Contact has no userId yet.
 *
 * Why this exists:
 *   The CRM creates Contact rows ahead of any User row (manual entry,
 *   scorecard, Wix capture). The Google sign-in path resolves the User
 *   by email but does NOT touch Contacts. Without this helper, a
 *   Contact created before sign-in stays orphaned (Contact.userId NULL)
 *   and the per-case access helper denies the client access to their
 *   own portal even though their identity is verified.
 *
 * Why it's safe to call on every successful sign-in:
 *   • The `userId: null` predicate means we ONLY link unlinked Contacts.
 *     A Contact already linked to a different User is never touched, so
 *     an attacker cannot hijack someone else's Contact by signing in
 *     with the same email (the unique constraint on User.email + the
 *     invite-only sign-in upstream both rule that out anyway, but the
 *     null-guard is defence-in-depth).
 *   • Case-insensitive email match accommodates rows stored with the
 *     casing the user originally typed (Wix forms, manual CRM entry).
 *   • Idempotent: re-running on the next sign-in returns count 0 once
 *     the link exists; no churn, no side-effects.
 *   • Doesn't widen sign-in: the caller has already verified the email
 *     belongs to the user (invite-only) and resolved their User row.
 *     We do NOT create Contacts or Users here.
 *
 * Returns the number of rows updated (0 or 1 in practice — Contact.email
 * has a unique constraint, so at most one row can match).
 */
export async function linkContactByEmail(
  prisma: PrismaService,
  email: string,
  userId: string,
): Promise<number> {
  const result = await prisma.contact.updateMany({
    where: {
      email:  { equals: email, mode: 'insensitive' },
      userId: null,
    },
    data: { userId },
  });
  return result.count;
}
