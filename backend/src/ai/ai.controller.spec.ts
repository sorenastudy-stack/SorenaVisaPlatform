import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AiController } from './ai.controller';
import { LeadsService } from '../leads/leads.service';
import { STAFF_PORTAL_ROLES } from '../staff/roles/staff-roles.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * PR-AI-GATE — who may qualify a lead, and which leads.
 *
 * Two things are worth pinning here, and they fail in different ways:
 *   - the ROLE metadata, because losing it turns the route back into
 *     "any authenticated account", which is how it shipped; and
 *   - the OWNERSHIP check, because a role gate alone still lets one SALES rep
 *     read another rep's lead by id.
 *
 * The ownership half runs against a real database — the rule is a query, and a
 * mock would agree with whatever the code believed.
 */

jest.setTimeout(90000);

describe('AiController — authorisation', () => {
  describe('route metadata', () => {
    it('gates qualify to the funnel roles, and never to a client role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, AiController.prototype.qualify);
      expect(roles).toEqual(LeadsService.FUNNEL_ROLES);
      // The regression that matters: a signed-in client must not be listed.
      for (const outsider of ['STUDENT', 'LEAD', 'AGENT']) {
        expect(roles).not.toContain(outsider);
      }
    });

    it('gates chat to staff, so no client account can spend tokens', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, AiController.prototype.chat);
      expect(roles).toEqual(STAFF_PORTAL_ROLES);
      for (const outsider of ['STUDENT', 'LEAD', 'AGENT']) {
        expect(roles).not.toContain(outsider);
      }
    });
  });

  describe('lead ownership', () => {
    let prisma: PrismaClient;
    let controller: AiController;
    const made = { leads: [] as string[], contacts: [] as string[], users: [] as string[] };
    let repA: string, repB: string;
    let leadOfA: string;

    // The agent is never reached in these tests — the guard throws first — so a
    // stub that would explode if called proves the check runs BEFORE the work.
    const explodingAgent: any = {
      qualify: jest.fn(async () => { throw new Error('qualify() must not run for a denied caller'); }),
    };

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.$connect();
      controller = new AiController(explodingAgent, {} as any, {} as any, prisma as any);

      const mk = async (role: string) => {
        const s = `ai${Date.now()}_${made.users.length}`;
        const u = await prisma.user.create({
          data: { name: `T ${s}`, email: `${s}@t.local`, passwordHash: 'x', role: role as any, isActive: true },
        });
        made.users.push(u.id);
        return u.id;
      };
      repA = await mk('SALES');
      repB = await mk('SALES');

      const s = `ai${Date.now()}`;
      const contact = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
      made.contacts.push(contact.id);
      const lead = await prisma.lead.create({
        data: { contactId: contact.id, leadStatus: 'NEW', ownerId: repA } as any,
      });
      made.leads.push(lead.id);
      leadOfA = lead.id;
    }, 90000);

    afterAll(async () => {
      await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
      await prisma.$disconnect();
    });

    const req = (id: string, role: string) => ({ user: { userId: id, role, secondaryRoles: [] } });

    it("refuses a rep asking about another rep's lead, as NOT FOUND", async () => {
      await expect(controller.qualify(leadOfA, req(repB, 'SALES')))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(explodingAgent.qualify).not.toHaveBeenCalled();
    });

    it('refuses a lead id that does not exist', async () => {
      await expect(controller.qualify('no-such-lead', req(repA, 'SALES')))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the owning rep through to the agent', async () => {
      // Reaching the (exploding) agent IS the pass condition: the guard let it by.
      await expect(controller.qualify(leadOfA, req(repA, 'SALES')))
        .rejects.toThrow('qualify() must not run for a denied caller');
    });

    it('lets an oversight role through for a lead they do not own', async () => {
      const owner = await prisma.user.create({
        data: { name: 'O', email: `o${Date.now()}@t.local`, passwordHash: 'x', role: 'OWNER', isActive: true },
      });
      made.users.push(owner.id);
      await expect(controller.qualify(leadOfA, req(owner.id, 'OWNER')))
        .rejects.toThrow('qualify() must not run for a denied caller');
    });
  });
});
