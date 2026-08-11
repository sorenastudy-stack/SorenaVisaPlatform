import { PrismaClient } from '@prisma/client';
import { CaseDocumentsService } from './case-documents.service';

/**
 * PR-DOCS-SLOT-ACCESS — SUPPORT and FINANCE on the cross-case document list.
 *
 * The endpoint admitted six roles while the page admitted eight, so a support
 * or finance user could open /staff/documents and get a 403 from it. The fix is
 * on the decorator, not the scoping: resolveScopedCaseIds already matched
 * supportId and financeId, which is the clearest evidence the omission was an
 * oversight rather than a decision.
 *
 * These tests exist to prove the half nobody had checked — that once let in,
 * those roles see their OWN cases and no others. A permission widened without
 * that proof is just a wider hole.
 */

jest.setTimeout(60000);

describe('Cross-case documents are scoped to the caller’s staff slot', () => {
  let prisma: PrismaClient;
  let service: CaseDocumentsService;

  const made = { docs: [] as string[], apps: [] as string[], cases: [] as string[], leads: [] as string[], contacts: [] as string[], users: [] as string[] };

  let support: string, finance: string, otherSupport: string, owner: string;
  let caseOfSupport: string, caseOfFinance: string, caseOfNeither: string;

  let seq = 0;
  const stamp = () => `sd${Date.now()}_${(seq += 1)}`;

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

  /**
   * A case with a named staff slot filled, carrying one STRUCTURED document.
   *
   * Structured (admission) rather than an "Other" Document row on purpose: the
   * Other bucket is admin-tier only, so a case whose sole document was an Other
   * row would be invisible to SUPPORT even when the scoping was correct — the
   * test would pass for the wrong reason and prove nothing.
   */
  async function mkCaseWithDoc(slot: Record<string, string> = {}) {
    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(c.id);
    const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW' } as any });
    made.leads.push(l.id);
    const k = await prisma.case.create({ data: { leadId: l.id, ...slot } as any });
    made.cases.push(k.id);
    const app = await prisma.admissionApplication.create({
      data: { caseId: k.id, contactId: c.id } as any,
    });
    made.apps.push(app.id);
    const d = await prisma.admissionDocument.create({
      data: {
        admissionApplicationId: app.id, documentType: 'PASSPORT',
        fileName: `doc-${s}.pdf`, fileUrl: `https://example.test/${s}.pdf`,
        mimeType: 'application/pdf', fileSizeBytes: 1024,
      } as any,
    });
    made.docs.push(d.id);
    return k.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new CaseDocumentsService(prisma as any, {} as any);

    support = await mkUser('SUPPORT');
    otherSupport = await mkUser('SUPPORT');
    finance = await mkUser('FINANCE');
    owner = await mkUser('OWNER');

    caseOfSupport = await mkCaseWithDoc({ supportId: support });
    caseOfFinance = await mkCaseWithDoc({ financeId: finance });
    caseOfNeither = await mkCaseWithDoc({ supportId: otherSupport });
  }, 60000);

  afterAll(async () => {
    await prisma.admissionDocument.deleteMany({ where: { id: { in: made.docs } } }).catch(() => {});
    await prisma.admissionApplication.deleteMany({ where: { id: { in: made.apps } } }).catch(() => {});
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const actor = (id: string, role: string) => ({ id, role, name: role });

  const caseIdsSeenBy = async (id: string, role: string) => {
    const rows = await service.listAllDocumentsAcrossCases(actor(id, role) as any);
    return new Set(rows.map((r: any) => r.caseId));
  };

  it('SUPPORT sees only cases where they hold the support slot', async () => {
    const seen = await caseIdsSeenBy(support, 'SUPPORT');
    expect(seen.has(caseOfSupport)).toBe(true);
    expect(seen.has(caseOfNeither)).toBe(false);
    expect(seen.has(caseOfFinance)).toBe(false);
  });

  it('FINANCE sees only cases where they hold the finance slot', async () => {
    const seen = await caseIdsSeenBy(finance, 'FINANCE');
    expect(seen.has(caseOfFinance)).toBe(true);
    expect(seen.has(caseOfSupport)).toBe(false);
    expect(seen.has(caseOfNeither)).toBe(false);
  });

  it('two support users on different cases cannot see each other’s', async () => {
    // The same role is not the same scope — the filter is on identity, not rank.
    const mine = await caseIdsSeenBy(support, 'SUPPORT');
    const theirs = await caseIdsSeenBy(otherSupport, 'SUPPORT');
    expect(mine.has(caseOfNeither)).toBe(false);
    expect(theirs.has(caseOfSupport)).toBe(false);
    expect(theirs.has(caseOfNeither)).toBe(true);
  });

  it('a staff user holding no slot at all sees nothing', async () => {
    const orphan = await mkUser('SUPPORT');
    const seen = await caseIdsSeenBy(orphan, 'SUPPORT');
    expect(seen.size).toBe(0);
  });

  it('OWNER still sees every case', async () => {
    const seen = await caseIdsSeenBy(owner, 'OWNER');
    expect(seen.has(caseOfSupport)).toBe(true);
    expect(seen.has(caseOfFinance)).toBe(true);
    expect(seen.has(caseOfNeither)).toBe(true);
  });
});
