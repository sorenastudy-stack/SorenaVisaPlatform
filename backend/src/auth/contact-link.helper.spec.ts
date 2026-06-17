/**
 * Client portal step 1 — focused unit test for linkContactByEmail.
 *
 * Pattern matches the other auth specs: hand-rolled prisma mock,
 * direct function call, assert the exact updateMany args.
 */

import { linkContactByEmail } from './contact-link.helper';

function makePrisma(updateMany: jest.Mock): any {
  return { contact: { updateMany } };
}

describe('linkContactByEmail (client portal step 1)', () => {
  it('returns the count from prisma.contact.updateMany', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const count = await linkContactByEmail(
      makePrisma(updateMany),
      'jane@example.com',
      'user-1',
    );
    expect(count).toBe(1);
  });

  it('returns 0 when no orphaned Contact matches (idempotent re-run)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const count = await linkContactByEmail(
      makePrisma(updateMany),
      'no-contact-yet@example.com',
      'user-1',
    );
    expect(count).toBe(0);
  });

  it('filters by case-insensitive email AND userId: null only', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await linkContactByEmail(makePrisma(updateMany), 'Mixed@Case.COM', 'user-99');

    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where.email).toEqual({ equals: 'Mixed@Case.COM', mode: 'insensitive' });
    expect(args.where.userId).toBeNull();
    expect(args.data).toEqual({ userId: 'user-99' });
  });

  it('never sets any field other than userId (no collateral overwrites)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await linkContactByEmail(makePrisma(updateMany), 'a@example.com', 'user-2');

    const args = updateMany.mock.calls[0][0];
    expect(Object.keys(args.data)).toEqual(['userId']);
  });

  it('the userId: null guard prevents overwriting an already-linked Contact', async () => {
    // We can't observe the DB from a mock, but we CAN assert that the
    // where clause carries the null guard. Any future refactor that
    // drops this predicate would fail this test.
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await linkContactByEmail(makePrisma(updateMany), 'a@example.com', 'user-3');

    const where = updateMany.mock.calls[0][0].where;
    expect(where).toHaveProperty('userId', null);
  });
});
