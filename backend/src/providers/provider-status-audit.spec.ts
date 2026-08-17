/**
 * PR-AUDIT — a provider's status change must leave a trace.
 *
 * This closes a real gap found during the catalogue import: an institution moved
 * PENDING → ACTIVE and NEITHER audit_logs NOR crm_events recorded it. The only
 * evidence was the row's own updatedAt, so "who made this live?" was
 * unanswerable — and provider.status is the third condition in the matching
 * gate, i.e. a control over what students can see.
 *
 * Proves: a transition is recorded with actor, from and to; a save that does not
 * touch status records nothing; and an audit failure never blocks the change.
 */

import { PrismaClient } from '@prisma/client';
import { ProvidersService } from './providers.service';

jest.setTimeout(60000);

// PR-AV slice 2 — ProvidersService now scans uploads. These tests exercise
// status/scholarship paths that upload nothing, so a clean-verdict stub keeps
// them focused; the real gate is proven by the EICAR route matrix.
const scanStub: any = { scanOrReject: async () => undefined };

describe('ProvidersService.updateProvider — status audit', () => {
  let prisma: PrismaClient;
  let svc: ProvidersService;
  const events: any = { emit: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new ProvidersService(prisma as any, events, {} as any, {} as any, {} as any, scanStub);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `aud${Date.now()}_${(seq += 1)}`;

  const mkProvider = (status: any = 'PENDING') =>
    prisma.educationProvider.create({
      data: { name: `Uni ${stamp()}`, providerType: 'UNIVERSITY', status } as any,
    });

  const auditFor = (providerId: string) =>
    prisma.auditLog.findMany({
      where: { entityType: 'EDUCATION_PROVIDER', entityId: providerId },
      orderBy: { createdAt: 'desc' },
    });

  async function mkActor() {
    return prisma.user.create({
      data: {
        email: `owner.${stamp()}@t.local`,
        name: 'Audit Test Owner',
        role: 'OWNER',
        isActive: true,
      } as any,
    });
  }

  it('records PENDING → ACTIVE with who, when, and from/to', async () => {
    const p = await mkProvider('PENDING');
    const actor = await mkActor();

    await svc.updateProvider(p.id, { status: 'ACTIVE' } as any, actor.id);

    const rows = await auditFor(p.id);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.eventType).toBe('PROVIDER_STATUS_CHANGED');
    expect(row.action).toBe('UPDATE');
    expect(row.userId).toBe(actor.id);
    expect(row.oldValue).toEqual({ status: 'PENDING' });
    expect(row.newValue).toMatchObject({ status: 'ACTIVE', providerName: p.name });
    expect(row.createdAt).toBeInstanceOf(Date);
    // snapshotted so the trail still reads correctly if the actor is renamed
    expect(row.actorNameSnapshot).toBe('Audit Test Owner');
    expect(row.actorRoleSnapshot).toBe('OWNER');
  });

  it('records the reverse transition too', async () => {
    const p = await mkProvider('ACTIVE');
    const actor = await mkActor();
    await svc.updateProvider(p.id, { status: 'INACTIVE' } as any, actor.id);
    const [row] = await auditFor(p.id);
    expect(row.oldValue).toEqual({ status: 'ACTIVE' });
    expect(row.newValue).toMatchObject({ status: 'INACTIVE' });
  });

  it('writes NOTHING when the save does not change status', async () => {
    // The trail must answer "who made this live", not "someone pressed Save".
    const p = await mkProvider('PENDING');
    const actor = await mkActor();

    await svc.updateProvider(p.id, { city: 'Hamilton', notes: 'edited' } as any, actor.id);

    expect(await auditFor(p.id)).toHaveLength(0);
    const after = await prisma.educationProvider.findUnique({ where: { id: p.id } });
    expect(after!.city).toBe('Hamilton'); // the edit still happened
  });

  it('writes nothing when status is submitted but unchanged', async () => {
    const p = await mkProvider('ACTIVE');
    const actor = await mkActor();
    await svc.updateProvider(p.id, { status: 'ACTIVE', city: 'Napier' } as any, actor.id);
    expect(await auditFor(p.id)).toHaveLength(0);
  });

  it('still records the change when there is no actor id', async () => {
    // A null actor is worse than a named one, but far better than no record.
    const p = await mkProvider('PENDING');
    await svc.updateProvider(p.id, { status: 'ACTIVE' } as any, null);
    const [row] = await auditFor(p.id);
    expect(row.userId).toBeNull();
    expect(row.newValue).toMatchObject({ status: 'ACTIVE' });
    expect(row.actorNameSnapshot).toBeNull();
  });

  it('an audit failure never blocks the status change', async () => {
    const p = await mkProvider('PENDING');
    const broken = new ProvidersService(
      { ...(prisma as any), auditLog: { create: jest.fn().mockRejectedValue(new Error('audit table down')) } } as any,
      events, {} as any, {} as any, {} as any, scanStub,
    );

    await expect(broken.updateProvider(p.id, { status: 'ACTIVE' } as any, null)).resolves.toBeTruthy();

    const after = await prisma.educationProvider.findUnique({ where: { id: p.id } });
    expect(after!.status).toBe('ACTIVE'); // the change stuck
    expect(await auditFor(p.id)).toHaveLength(0); // and no row, as expected
  });

  it('404s an unknown provider instead of writing an orphan audit row', async () => {
    await expect(svc.updateProvider('does-not-exist', { status: 'ACTIVE' } as any, null)).rejects.toThrow();
  });
});
