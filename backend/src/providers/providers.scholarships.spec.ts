/**
 * PR-UNIVERSITIES — ProviderScholarship CRUD (DB-backed) + role-gating metadata.
 * Proves: create normalises nationality/currency + applies defaults; a programme
 * from another provider is rejected; programme/level scoping sticks; list orders
 * active-first; partial update; delete; and that the commercial write endpoints
 * (provider create/update/agreement + all scholarship writes) are OWNER/SUPER_ADMIN.
 */

import { PrismaClient } from '@prisma/client';
import { ProvidersService } from './providers.service';
import { ProvidersController } from './providers.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

jest.setTimeout(60000);

const events: any = { emit: jest.fn().mockResolvedValue(undefined) };

describe('ProviderScholarship CRUD + gating', () => {
  let prisma: PrismaClient;
  let svc: ProvidersService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    // scholarship methods use neither the importer, the web-sync service, nor R2
    // (PR-EXPLORE added R2 for programme cover images) → stub them all.
    svc = new ProvidersService(prisma as any, events, {} as any, {} as any, {} as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `uni${Date.now()}_${(seq += 1)}`;

  async function mkProvider() {
    const s = stamp();
    return prisma.educationProvider.create({ data: { name: `Uni ${s}`, providerType: 'UNIVERSITY' } as any });
  }
  async function mkProgramme(providerId: string) {
    const s = stamp();
    return prisma.educationProgramme.create({ data: { providerId, name: `Prog ${s}`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' } as any });
  }

  it('creates a scholarship: nationality/currency normalised, defaults applied', async () => {
    const p = await mkProvider();
    const sch = await svc.addScholarship(p.id, { nationality: 'ir', name: 'Iran Merit Award', amountValue: 5000 }, 'owner-1');
    expect(sch.nationality).toBe('IR');       // upper-cased
    expect(sch.currency).toBe('NZD');          // default
    expect(sch.amountType).toBe('FIXED');      // default
    expect(sch.isActive).toBe(true);           // default
    expect(sch.updatedById).toBe('owner-1');
  });

  it('rejects a programme that belongs to a different provider', async () => {
    const p1 = await mkProvider();
    const p2 = await mkProvider();
    const otherProgramme = await mkProgramme(p2.id);
    await expect(
      svc.addScholarship(p1.id, { nationality: 'IN', name: 'X', amountValue: 1, programmeId: otherProgramme.id }, 'o'),
    ).rejects.toBeDefined();
  });

  it('accepts programme + level scoping when the programme belongs to the provider', async () => {
    const p = await mkProvider();
    const prog = await mkProgramme(p.id);
    const sch = await svc.addScholarship(p.id, {
      nationality: 'CN', name: 'PG Scholarship', amountType: 'PERCENTAGE', amountValue: 20,
      programmeId: prog.id, level: 'MASTER',
    }, 'owner-1');
    expect(sch.programmeId).toBe(prog.id);
    expect(sch.level).toBe('MASTER');
    expect(sch.amountType).toBe('PERCENTAGE');
  });

  it('lists a provider’s scholarships (active first) and supports partial update + delete', async () => {
    const p = await mkProvider();
    const a = await svc.addScholarship(p.id, { nationality: 'IR', name: 'A', amountValue: 1000 }, 'o');
    await svc.addScholarship(p.id, { nationality: 'IN', name: 'B', amountValue: 2000, isActive: false }, 'o');

    const list = await svc.findScholarships(p.id);
    expect(list.length).toBe(2);
    expect(list[0].isActive).toBe(true); // active first

    const updated = await svc.updateScholarship(a.id, { amountValue: 1500, isActive: false }, 'o2');
    expect(updated.amountValue).toBe(1500);
    expect(updated.isActive).toBe(false);
    expect(updated.updatedById).toBe('o2');

    await svc.deleteScholarship(a.id, 'o2');
    expect(await prisma.providerScholarship.findUnique({ where: { id: a.id } })).toBeNull();
  });

  it('commercial write endpoints are OWNER/SUPER_ADMIN; scholarship reads stay catalog-wide', () => {
    const roles = (m: keyof ProvidersController) =>
      Reflect.getMetadata(ROLES_KEY, ProvidersController.prototype[m] as any) as string[];

    for (const m of ['create', 'update', 'updateAgreement', 'addScholarship', 'updateScholarship', 'deleteScholarship'] as const) {
      expect(roles(m).sort()).toEqual(['OWNER', 'SUPER_ADMIN']);
    }
    // reads remain available to admission-handling staff
    expect(roles('findScholarships')).toContain('CONSULTANT');
  });
});
