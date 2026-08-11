import { PrismaClient } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CaseHandoffService } from './case-handoff.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * PR-HANDOFF — handing a case to the next stage.
 *
 * Against a real database. The properties worth testing are the ones that stop
 * this becoming a way to move work onto other people's desks: that the sender
 * actually holds the stage they claim, that accepting is limited to the
 * recipient, and that a double-click does not queue the same case twice.
 *
 * The load-balancing assignment is stubbed rather than exercised — it has its
 * own suite, and stubbing it lets these tests say exactly who was picked.
 */

jest.setTimeout(60000);

describe('Case handoffs', () => {
  let prisma: PrismaClient;
  let service: CaseHandoffService;
  let notifications: NotificationsService;
  let sendCaseHandoff: jest.Mock;
  let assignFinance: jest.Mock;
  let assignSupport: jest.Mock;

  const made = { handoffs: [] as string[], notes: [] as string[], cases: [] as string[], leads: [] as string[], contacts: [] as string[], users: [] as string[] };

  let admission: string, support: string, finance: string, lia: string, owner: string, stranger: string;
  let caseId: string;

  let seq = 0;
  const stamp = () => `ho${Date.now()}_${(seq += 1)}`;

  async function mkUser(role: string) {
    const s = stamp();
    const u = await prisma.user.create({
      data: {
        name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`,
        passwordHash: 'x', role: role as any, isActive: true,
      },
    });
    made.users.push(u.id);
    return u.id;
  }

  async function mkCase(slots: Record<string, string | null> = {}) {
    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(c.id);
    const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW' } as any });
    made.leads.push(l.id);
    const k = await prisma.case.create({ data: { leadId: l.id, ...slots } as any });
    made.cases.push(k.id);
    return k.id;
  }

  const actor = (id: string, role: string, name = role) => ({ id, role, name, secondaryRoles: [] });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    notifications = new NotificationsService(prisma as any);

    sendCaseHandoff = jest.fn().mockResolvedValue(undefined);
    assignSupport = jest.fn();
    assignFinance = jest.fn();
    const assignments: any = {
      assignPastoralCareToCase: assignSupport,
      assignFinanceToCase: assignFinance,
      assignLiaToCase: jest.fn().mockResolvedValue({ status: 'assigned', liaId: null }),
      assignAdmissionToCase: jest.fn().mockResolvedValue({ status: 'assigned', ownerId: null }),
    };
    service = new CaseHandoffService(
      prisma as any, assignments, { sendCaseHandoff } as any, notifications,
    );

    admission = await mkUser('CONSULTANT');
    support = await mkUser('SUPPORT');
    finance = await mkUser('FINANCE');
    lia = await mkUser('LIA');
    owner = await mkUser('OWNER');
    stranger = await mkUser('CONSULTANT');

    assignSupport.mockResolvedValue({ status: 'assigned', supportId: support });
    assignFinance.mockResolvedValue({ status: 'assigned', financeId: finance });
  }, 60000);

  afterAll(async () => {
    await prisma.caseHandoff.deleteMany({ where: { caseId: { in: made.cases } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: made.users } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { userId: { in: made.users } } }).catch(() => {});
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(() => { sendCaseHandoff.mockClear(); });

  describe('the ownership guard', () => {
    it('refuses someone who does not hold the stage they claim', async () => {
      // The whole point of the endpoint. Without this, any entitled role could
      // push work into a colleague's queue on a case they never touched — and
      // the record would name them as the sender.
      const k = await mkCase({ ownerId: admission });
      await expect(service.handOff(k, 'ADMISSION', actor(stranger, 'CONSULTANT')))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.caseHandoff.count({ where: { caseId: k } })).toBe(0);
    });

    it('allows the person who holds the stage', async () => {
      const k = await mkCase({ ownerId: admission });
      const h = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));
      expect(h.fromSlot).toBe('ADMISSION');
      expect(h.toSlot).toBe('SUPPORT');
    });

    it('lets admin tier hand off a case they hold no slot on', async () => {
      // Unsticking someone else's case is exactly an admin's job.
      const k = await mkCase({ ownerId: admission });
      const h = await service.handOff(k, 'ADMISSION', actor(owner, 'OWNER'));
      expect(h.toUserId).toBe(support);
    });

    it('refuses a handoff from the final stage', async () => {
      const k = await mkCase({ liaId: lia });
      await expect(service.handOff(k, 'LIA', actor(lia, 'LIA')))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s on an unknown case', async () => {
      await expect(service.handOff('nope', 'ADMISSION', actor(owner, 'OWNER')))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assignment', () => {
    it('uses the existing load-balancing pick by default', async () => {
      const k = await mkCase({ ownerId: admission });
      const h = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));
      expect(assignSupport).toHaveBeenCalledWith(k, expect.objectContaining({ id: admission }));
      expect(h.toUserId).toBe(support);
      // The name is snapshotted so the history survives the account.
      expect(h.toUserName).toBeTruthy();
    });

    it('an explicit recipient overrides the pick AND fills the slot', async () => {
      // The override must move the Case slot too, or the handoff and the slot
      // disagree about who owns the next stage.
      const k = await mkCase({ supportId: support });
      const other = await mkUser('FINANCE');
      const h = await service.handOff(k, 'SUPPORT', actor(support, 'SUPPORT'), { toUserId: other });
      expect(h.toUserId).toBe(other);
      const after = await prisma.case.findUnique({ where: { id: k }, select: { financeId: true } });
      expect(after!.financeId).toBe(other);
    });

    it('refuses an inactive recipient', async () => {
      const k = await mkCase({ supportId: support });
      const gone = await mkUser('FINANCE');
      await prisma.user.update({ where: { id: gone }, data: { isActive: false } });
      await expect(service.handOff(k, 'SUPPORT', actor(support, 'SUPPORT'), { toUserId: gone }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('still records the handoff when nobody can receive it', async () => {
      // Silently dropping it would hide the staffing gap that caused it.
      const k = await mkCase({ supportId: support });
      assignFinance.mockResolvedValueOnce({ status: 'no_candidates', financeId: null });
      const h = await service.handOff(k, 'SUPPORT', actor(support, 'SUPPORT'));
      expect(h.toUserId).toBeNull();
      expect(h.status).toBe('PENDING');
    });

    it('a double-click does not queue the same case twice', async () => {
      const k = await mkCase({ ownerId: admission });
      const a = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));
      const b = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));
      expect(b.id).toBe(a.id);
      expect(await prisma.caseHandoff.count({ where: { caseId: k, toSlot: 'SUPPORT' } })).toBe(1);
    });
  });

  describe('notification', () => {
    it('emails the recipient and files an in-app notification', async () => {
      const k = await mkCase({ ownerId: admission });
      await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT', 'Ada'));

      expect(sendCaseHandoff).toHaveBeenCalledTimes(1);
      const [, , , clientName, fromName] = sendCaseHandoff.mock.calls[0];
      expect(clientName).toMatch(/^Client /);
      expect(fromName).toBe('Ada');

      const inApp = await prisma.notification.findFirst({
        where: { userId: support, type: 'CASE_HANDOFF' },
        orderBy: { createdAt: 'desc' },
      });
      expect(inApp).toBeTruthy();
      expect(inApp!.read).toBe(false);
      expect(inApp!.link).toBe('/staff/handoffs/my-queue');
    });

    it('a failed email does not undo the handoff', async () => {
      // The case has already moved. Losing the record because a mail server
      // hiccuped would be worse than a missed email.
      const k = await mkCase({ ownerId: admission });
      sendCaseHandoff.mockRejectedValueOnce(new Error('smtp down'));
      const h = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));
      expect(h.id).toBeTruthy();
      expect(await prisma.caseHandoff.count({ where: { id: h.id } })).toBe(1);
    });
  });

  describe('the queue and accepting', () => {
    it('my-queue shows only what is addressed to me, still pending', async () => {
      const k = await mkCase({ ownerId: admission });
      const h = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));

      const mine = await service.myQueue(support);
      expect(mine.map((x: any) => x.id)).toContain(h.id);
      const theirs = await service.myQueue(finance);
      expect(theirs.map((x: any) => x.id)).not.toContain(h.id);
    });

    it('only the recipient can accept, and it is idempotent', async () => {
      const k = await mkCase({ ownerId: admission });
      const h = await service.handOff(k, 'ADMISSION', actor(admission, 'CONSULTANT'));

      // Not-found rather than forbidden: a handoff addressed to someone else is
      // not a record this caller may know exists.
      await expect(service.accept(h.id, actor(finance, 'FINANCE')))
        .rejects.toBeInstanceOf(NotFoundException);

      const ok = await service.accept(h.id, actor(support, 'SUPPORT'));
      expect(ok.status).toBe('ACCEPTED');
      expect(ok.acceptedAt).toBeTruthy();

      const again = await service.accept(h.id, actor(support, 'SUPPORT'));
      expect(again.acceptedAt!.getTime()).toBe(ok.acceptedAt!.getTime());

      expect((await service.myQueue(support)).map((x: any) => x.id)).not.toContain(h.id);
    });
  });

  describe('notifications service', () => {
    it('counts unread, lists newest-first, and marks read', async () => {
      const u = await mkUser('SUPPORT');
      await notifications.create({ userId: u, type: 'T', title: 'one' });
      const second = await notifications.create({ userId: u, type: 'T', title: 'two' });

      expect(await notifications.unreadCount(u)).toBe(2);
      const listed = await notifications.list(u);
      expect(listed.items[0].id).toBe(second.id);
      expect(listed.unread).toBe(2);

      await notifications.markRead(second.id, u);
      expect(await notifications.unreadCount(u)).toBe(1);

      await notifications.markAllRead(u);
      expect(await notifications.unreadCount(u)).toBe(0);
    });

    it('cannot mark someone else’s notification read', async () => {
      const mine = await notifications.create({ userId: support, type: 'T', title: 'mine' });
      await expect(notifications.markRead(mine.id, finance))
        .rejects.toBeInstanceOf(NotFoundException);
      const still = await prisma.notification.findUnique({ where: { id: mine.id } });
      expect(still!.read).toBe(false);
    });
  });
});
