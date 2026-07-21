/**
 * PR-CONTACT-LINK — unit tests for linkCaseContactToUser.
 *
 * Pattern matches auth/contact-link.helper.spec.ts: a hand-rolled prisma mock,
 * a direct function call, and assertions on the exact prisma args. Covers the
 * email-match link, the idempotent/skip branches, and the Contact.userId
 * @unique conflict handling (move a case-less stray vs. refuse a real conflict).
 */

import { linkCaseContactToUser } from './link-case-contact.helper';

interface MockOpts {
  // case → lead → contact; pass null for "no contact in the chain"
  contact?: { id: string; email: string | null; userId: string | null } | null;
  user?: { id: string } | null; // user matched by email (or null)
  otherContact?: { id: string } | null; // contact already holding user.id (@unique)
  otherCasesCount?: number; // how many cases that other contact owns
}

function makePrisma(opts: MockOpts) {
  const contactUpdate = jest.fn().mockResolvedValue({});
  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    case: {
      findUnique: jest.fn().mockResolvedValue({ lead: { contact: opts.contact ?? null } }),
      count: jest.fn().mockResolvedValue(opts.otherCasesCount ?? 0),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue(opts.user ?? null),
    },
    contact: {
      findUnique: jest.fn().mockResolvedValue(opts.otherContact ?? null),
      update: contactUpdate,
    },
    auditLog: { create: auditCreate },
    // Execute the callback with a tx that reuses the same spies.
    $transaction: jest.fn(async (cb: any) =>
      cb({ contact: { update: contactUpdate }, auditLog: { create: auditCreate } }),
    ),
  };
  return { prisma, contactUpdate, auditCreate };
}

describe('linkCaseContactToUser (PR-CONTACT-LINK)', () => {
  it('links an unlinked case-contact to the email-matched user (case-insensitive)', async () => {
    const { prisma, contactUpdate, auditCreate } = makePrisma({
      contact: { id: 'contact-A', email: 'Oscar@Example.com', userId: null },
      user: { id: 'user-1' },
      otherContact: null,
    });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: true, userId: 'user-1', reason: 'linked' });
    // matched case-insensitively on the contact's email
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'Oscar@Example.com', mode: 'insensitive' } },
      select: { id: true },
    });
    // linked the CASE-BEARING contact (not some other row)
    expect(contactUpdate).toHaveBeenCalledTimes(1);
    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: 'contact-A' },
      data: { userId: 'user-1' },
    });
    // wrote the audit trail
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe('CONTACT_AUTO_LINKED_TO_USER');
    expect(audit.entityId).toBe('contact-A');
    expect(audit.newValue).toMatchObject({ userId: 'user-1', contactId: 'contact-A', caseId: 'case-1' });
    expect(audit.newValue.movedFromContactId).toBeUndefined();
  });

  it('is idempotent: an already-linked contact is left untouched', async () => {
    const { prisma, contactUpdate, auditCreate } = makePrisma({
      contact: { id: 'contact-A', email: 'x@x.com', userId: 'user-9' },
    });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: false, userId: 'user-9', reason: 'already_linked' });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('skips when the contact has no email to match on', async () => {
    const { prisma, contactUpdate } = makePrisma({
      contact: { id: 'contact-A', email: null, userId: null },
    });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: false, userId: null, reason: 'no_email' });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('skips when no user matches the email', async () => {
    const { prisma, contactUpdate } = makePrisma({
      contact: { id: 'contact-A', email: 'nouser@x.com', userId: null },
      user: null,
    });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: false, userId: null, reason: 'no_matching_user' });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('skips (warns, no write) when the user is already linked to a contact WITH cases', async () => {
    const { prisma, contactUpdate, auditCreate } = makePrisma({
      contact: { id: 'contact-A', email: 'x@x.com', userId: null },
      user: { id: 'user-1' },
      otherContact: { id: 'contact-B' },
      otherCasesCount: 2,
    });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: false, userId: null, reason: 'user_linked_to_contact_with_cases' });
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('moves the link off a case-less stray contact (clears it first, then links)', async () => {
    const { prisma, contactUpdate, auditCreate } = makePrisma({
      contact: { id: 'contact-A', email: 'x@x.com', userId: null },
      user: { id: 'user-1' },
      otherContact: { id: 'contact-B' },
      otherCasesCount: 0,
    });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: true, userId: 'user-1', reason: 'linked' });
    // clear the stray's @unique userId slot FIRST, then link the case contact
    expect(contactUpdate).toHaveBeenNthCalledWith(1, { where: { id: 'contact-B' }, data: { userId: null } });
    expect(contactUpdate).toHaveBeenNthCalledWith(2, { where: { id: 'contact-A' }, data: { userId: 'user-1' } });
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.newValue.movedFromContactId).toBe('contact-B');
  });

  it('returns no_contact when the case → lead → contact chain is missing', async () => {
    const { prisma, contactUpdate } = makePrisma({ contact: null });

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: false, userId: null, reason: 'no_contact' });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('never throws — a DB error resolves to an error result', async () => {
    const { prisma } = makePrisma({ contact: { id: 'c', email: 'x@x.com', userId: null } });
    prisma.case.findUnique = jest.fn().mockRejectedValue(new Error('db down'));

    const res = await linkCaseContactToUser(prisma, 'case-1');

    expect(res).toEqual({ linked: false, userId: null, reason: 'error' });
  });
});
