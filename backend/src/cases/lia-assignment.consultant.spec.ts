/**
 * PR-ALLOC — assignConsultantToCase (Client Officer / CLIENT_CONSULTANT) pool
 * selection + least-loaded distribution. DB-backed (real Prisma, throwaway DB),
 * mail mocked.
 *
 * Confirmed pool priority:
 *   1. language-match   — an officer who speaks the client's own language
 *   2. english-fallback — no match / English client → English-speaking officers
 *   3. all-fallback     — no English speaker either → full pool (last resort)
 * Least-loaded within the chosen pool in every case.
 *
 * Isolation: findActiveConsultants sees EVERY active CLIENT_CONSULTANT, so a
 * beforeEach deactivates all of them and each test seeds only its own pool.
 */

import { PrismaClient } from '@prisma/client';
import { LiaAssignmentService } from './lia-assignment.service';

jest.setTimeout(60000);

describe('assignConsultantToCase — pool selection + least-loaded', () => {
  let prisma: PrismaClient;
  let svc: LiaAssignmentService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const mail = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) }) as any;
    svc = new LiaAssignmentService(prisma as any, mail);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  // Start every test from a clean pool — only this test's seeded officers active.
  beforeEach(async () => {
    await prisma.user.updateMany({ where: { role: 'CLIENT_CONSULTANT' }, data: { isActive: false } });
  });

  let seq = 0;
  const stamp = () => `co${Date.now()}_${(seq += 1)}`;

  async function seedConsultant(languages: string[]) {
    const s = stamp();
    return prisma.user.create({
      data: { name: `CO ${s}`, email: `co.${s}@t.local`, passwordHash: 'x', role: 'CLIENT_CONSULTANT', isActive: true, languages },
    });
  }

  async function seedCase(preferredLanguage: string) {
    const s = stamp();
    const contact = await prisma.contact.create({
      data: { fullName: `Client ${s}`, email: `client.${s}@t.local`, preferredLanguage },
    });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'NEW' } });
    return prisma.case.create({ data: { leadId: lead.id } });
  }

  it('language-match: picks an officer who speaks the client language', async () => {
    const fa = await seedConsultant(['fa', 'en']);
    await seedConsultant(['ar', 'en']); // decoy
    const kase = await seedCase('fa');

    const res = await svc.assignConsultantToCase(kase.id);
    expect(res.status).toBe('assigned');
    expect(res.consultantId).toBe(fa.id);
    expect(res.langMatched).toBe(true);
  });

  it('english-fallback: no language match → narrows to an ENGLISH speaker (not just any officer)', async () => {
    const english = await seedConsultant(['en']);
    const nonEnglish = await seedConsultant(['de']); // speaks neither client lang nor English
    const kase = await seedCase('vi'); // Vietnamese — nobody speaks it

    const res = await svc.assignConsultantToCase(kase.id);
    expect(res.status).toBe('assigned');
    expect(res.consultantId).toBe(english.id);
    expect(res.consultantId).not.toBe(nonEnglish.id);
    expect(res.langMatched).toBe(false);
  });

  it('english-fallback also applies when the CLIENT speaks English', async () => {
    const english = await seedConsultant(['en', 'fr']);
    await seedConsultant(['de']); // no English → must not be chosen
    const kase = await seedCase('en');

    const res = await svc.assignConsultantToCase(kase.id);
    expect(res.consultantId).toBe(english.id);
    expect(res.langMatched).toBe(false); // english-fallback, not a "match" per the flag
  });

  it('all-fallback (edge): no match and NO English speaker → still assigns (last resort)', async () => {
    const only = await seedConsultant(['de']); // no client-lang, no English
    const kase = await seedCase('vi');

    const res = await svc.assignConsultantToCase(kase.id);
    expect(res.status).toBe('assigned');
    expect(res.consultantId).toBe(only.id); // never left unassigned
  });

  it('least-loaded: 6 cases across 3 equal English officers distribute 2/2/2, not piled on one', async () => {
    const a = await seedConsultant(['en']);
    const b = await seedConsultant(['en']);
    const c = await seedConsultant(['en']);
    const counts: Record<string, number> = { [a.id]: 0, [b.id]: 0, [c.id]: 0 };

    for (let i = 0; i < 6; i++) {
      const kase = await seedCase('en');
      const res = await svc.assignConsultantToCase(kase.id);
      expect(res.consultantId && counts[res.consultantId] !== undefined).toBe(true);
      counts[res.consultantId!]++;
    }

    expect(counts[a.id]).toBe(2);
    expect(counts[b.id]).toBe(2);
    expect(counts[c.id]).toBe(2);
  });
});
