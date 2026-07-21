import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// PR-CONTACT-LINK — repair for the production "contact-split" bug.
//
// When a lead is converted via the staff "Create case" flow, the case-bearing
// Contact can have userId = NULL while the client's real login User is either
// unlinked or linked to a *different*, case-less duplicate Contact. The client
// portal resolves the case via `lead.contact.userId`, so a NULL there makes the
// portal show "your case isn't set up yet", and LEAD→STUDENT promotion silently
// bails (it needs contact.userId).
//
// This helper closes the gap from the case side: after a case exists, it links
// the case-bearing Contact to the User whose email matches (case-insensitive),
// respecting the Contact.userId @unique constraint.
//
// Direction note: this is the mirror of auth/contact-link.helper.ts's
// linkContactByEmail (that one runs at SIGN-IN, User→Contact). This one runs at
// CASE CREATION / contract sign, resolving User FROM the case's contact email.
//
// NEVER THROWS: case creation and the DocuSign webhook must not fail because a
// best-effort auto-link hit a snag. Every failure resolves to a non-linked
// result and a log line.

const logger = new Logger('linkCaseContactToUser');

export type ContactLinkReason =
  | 'linked' // newly linked this call
  | 'already_linked' // contact already had a userId
  | 'no_contact' // case → lead → contact chain missing
  | 'no_email' // contact has no email to match on
  | 'no_matching_user' // no User with that email
  | 'user_linked_to_contact_with_cases' // conflict we must not auto-resolve
  | 'error'; // unexpected failure (never thrown)

export interface ContactLinkResult {
  linked: boolean;
  userId: string | null;
  reason: ContactLinkReason;
}

/**
 * Link the case-bearing Contact to its client's login User by email.
 *
 * Rules:
 *   • Only acts when the contact has NO userId yet (never hijacks a linked one).
 *   • Case-insensitive email match (Wix / manual CRM rows vary in casing).
 *   • Respects Contact.userId @unique: if the matched User is already linked to
 *     a DIFFERENT contact, we only re-point when that other contact has no
 *     cases (a stray duplicate). If it has cases, we log a warning and skip —
 *     that's a genuine data conflict for a human to reconcile.
 *   • Writes a CONTACT_AUTO_LINKED_TO_USER audit row on success.
 *   • Idempotent: a second call after linking returns 'already_linked'.
 */
export async function linkCaseContactToUser(
  prisma: PrismaService,
  caseId: string,
): Promise<ContactLinkResult> {
  try {
    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: {
        lead: { select: { contact: { select: { id: true, email: true, userId: true } } } },
      },
    });
    const contact = c?.lead?.contact;
    if (!contact) return { linked: false, userId: null, reason: 'no_contact' };
    if (contact.userId) {
      return { linked: false, userId: contact.userId, reason: 'already_linked' };
    }
    if (!contact.email) return { linked: false, userId: null, reason: 'no_email' };

    const user = await prisma.user.findFirst({
      where: { email: { equals: contact.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!user) return { linked: false, userId: null, reason: 'no_matching_user' };

    // Contact.userId is @unique — is this user already linked elsewhere?
    const otherContact = await prisma.contact.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    let movedFromContactId: string | null = null;
    if (otherContact && otherContact.id !== contact.id) {
      const otherCases = await prisma.case.count({
        where: { lead: { contactId: otherContact.id } },
      });
      if (otherCases > 0) {
        logger.warn(
          `Auto-link skipped for case ${caseId}: user ${user.id} is already linked to contact ` +
            `${otherContact.id} which owns ${otherCases} case(s) — needs manual reconciliation.`,
        );
        return { linked: false, userId: null, reason: 'user_linked_to_contact_with_cases' };
      }
      // The other contact is a case-less stray → safe to move the link.
      movedFromContactId = otherContact.id;
    }

    await prisma.$transaction(async (tx) => {
      // Free the @unique userId slot first when moving off a stray contact.
      if (movedFromContactId) {
        await tx.contact.update({ where: { id: movedFromContactId }, data: { userId: null } });
      }
      await tx.contact.update({ where: { id: contact.id }, data: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'CONTACT_AUTO_LINKED_TO_USER',
          eventType: 'CONTACT_AUTO_LINKED_TO_USER',
          entityType: 'Contact',
          entityId: contact.id,
          newValue: {
            caseId,
            contactId: contact.id,
            userId: user.id,
            matchedEmail: contact.email,
            ...(movedFromContactId ? { movedFromContactId } : {}),
          } as Prisma.InputJsonValue,
          actorNameSnapshot: 'SYSTEM',
          actorRoleSnapshot: 'SYSTEM',
        },
      });
    });

    logger.log(
      `Auto-linked contact ${contact.id} → user ${user.id} for case ${caseId} (email match)` +
        (movedFromContactId ? ` [moved link off case-less contact ${movedFromContactId}]` : ''),
    );
    return { linked: true, userId: user.id, reason: 'linked' };
  } catch (err: any) {
    // e.g. P2002 if a concurrent sign-in/webhook raced the link — best-effort.
    logger.error(`Auto-link failed for case ${caseId}: ${err?.message ?? err}`);
    return { linked: false, userId: null, reason: 'error' };
  }
}
