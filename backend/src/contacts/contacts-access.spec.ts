import { PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';

/**
 * PR-ACCESS-AUDIT — the contact directory, scoped to leads the caller owns.
 *
 * /contacts returned every contact in the CRM to every role that could reach
 * it. That is the client list: names, emails, phone numbers.
 *
 * A Contact is NOT single-owner. Lead.contactId is not unique, so one contact
 * can carry several leads — in production 5 contacts do, one of them 8 — and
 * nothing stops two of those leads having different owners. The filter is
 * therefore "any lead touching this contact that I own", not "the owner of the
 * contact", which is a field that does not exist. Two owners of two leads on
 * the same person both see that person, which is the correct answer: they are
 * each working with them.
 *
 * The multi-owner case is constructed here rather than assumed absent. It does
 * not occur in production today, and a rule that has never met its own edge
 * case is a rule nobody has tested.
 */

jest.setTimeout(60000);

describe('contact directory scoping', () => {
  let prisma: PrismaClient;
  let contacts: ContactsService;

  const made = { leads: [] as string[], contacts: [] as string[], users: [] as string[] };

  let salesA: string, salesB: string, ownerUser: string;
  let contactOfA: string, contactOfB: string, contactShared: string, contactUnowned: string;

  let seq = 0;
  const stamp = () => `ct${Date.now()}_${(seq += 1)}`;

  async function mkUser(role: string, secondaryRoles: string[] = []) {
    const s = stamp();
    const u = await prisma.user.create({
      data: {
        name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`,
        passwordHash: 'x', role: role as any, isActive: true,
        secondaryRoles: secondaryRoles as any,
      },
    });
    made.users.push(u.id);
    return u.id;
  }

  /** A contact plus one lead per owner given. No owners = a contact nobody works. */
  async function mkContact(owners: (string | null)[]) {
    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(c.id);
    for (const ownerId of owners) {
      const l = await prisma.lead.create({
        data: { contactId: c.id, leadStatus: 'NEW', ownerId } as any,
      });
      made.leads.push(l.id);
    }
    return c.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    contacts = new ContactsService(prisma as any);

    salesA = await mkUser('SALES');
    salesB = await mkUser('SALES');
    ownerUser = await mkUser('OWNER');

    contactOfA = await mkContact([salesA]);
    contactOfB = await mkContact([salesB]);
    // The case the single-owner model gets wrong: two reps, two leads, one person.
    contactShared = await mkContact([salesA, salesB]);
    contactUnowned = await mkContact([]);
  }, 60000);

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const actor = (id: string, role: string, secondaryRoles: string[] = []) =>
    ({ id, role, secondaryRoles });

  describe('findAll', () => {
    it('a scoped role sees only contacts they have a lead on', async () => {
      const ids = (await contacts.findAll(undefined, actor(salesA, 'SALES'))).map((r: any) => r.id);
      expect(ids).toContain(contactOfA);
      expect(ids).toContain(contactShared);
      expect(ids).not.toContain(contactOfB);
      expect(ids).not.toContain(contactUnowned);
    });

    it('both reps see a contact they each hold a lead on', async () => {
      const a = (await contacts.findAll(undefined, actor(salesA, 'SALES'))).map((r: any) => r.id);
      const b = (await contacts.findAll(undefined, actor(salesB, 'SALES'))).map((r: any) => r.id);
      expect(a).toContain(contactShared);
      expect(b).toContain(contactShared);
    });

    it('search cannot be used to reach outside the scope', async () => {
      // The dangerous shape: a filter applied after the scope, or instead of it.
      const target = await prisma.contact.findUnique({ where: { id: contactOfB } });
      const ids = (await contacts.findAll(target!.fullName!, actor(salesA, 'SALES'))).map((r: any) => r.id);
      expect(ids).not.toContain(contactOfB);
    });

    it('oversight roles still see the whole directory', async () => {
      const ids = (await contacts.findAll(undefined, actor(ownerUser, 'OWNER'))).map((r: any) => r.id);
      expect(ids).toEqual(
        expect.arrayContaining([contactOfA, contactOfB, contactShared, contactUnowned]),
      );
    });

    it('a SECONDARY oversight role widens a scoped one', async () => {
      const ids = (await contacts.findAll(undefined, actor(salesA, 'SALES', ['ADMIN']))).map((r: any) => r.id);
      expect(ids).toContain(contactOfB);
    });
  });

  describe('findOne', () => {
    it('a scoped role reads a contact they hold a lead on', async () => {
      await expect(contacts.findOne(contactOfA, actor(salesA, 'SALES'))).resolves.toMatchObject({
        id: contactOfA,
      });
    });

    it('a scoped role cannot read another rep’s contact by id', async () => {
      // Scoping the list alone leaves the obvious hole: fetch it by id instead.
      await expect(contacts.findOne(contactOfB, actor(salesA, 'SALES'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('a contact with no leads is not readable by a scoped role', async () => {
      await expect(contacts.findOne(contactUnowned, actor(salesA, 'SALES'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('oversight roles read any contact by id', async () => {
      await expect(contacts.findOne(contactOfB, actor(ownerUser, 'OWNER'))).resolves.toMatchObject({
        id: contactOfB,
      });
    });
  });
});
