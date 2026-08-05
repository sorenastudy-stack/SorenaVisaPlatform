/**
 * PR-CURATION — the Owner's programme review screen, DB-backed.
 *
 * Proves the things that decide what a student can see:
 *   * Active moves BOTH gates the matching engine reads (reviewStatus + isActive)
 *   * Inactive returns to PENDING, not REJECTED
 *   * deactivating a programme a student already holds is REFUSED until confirmed,
 *     and the refusal names the affected case
 *   * a direct edit saves immediately and audits ONLY the fields that changed
 *   * the whitelist keeps reviewStatus/isActive/sourceRef out of the edit path
 *   * every curation route is OWNER/SUPER_ADMIN
 */

import { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { ProgrammeCurationService } from './programme-curation.service';
import { ProvidersController } from './providers.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

jest.setTimeout(60000);

describe('ProgrammeCurationService', () => {
  let prisma: PrismaClient;
  let svc: ProgrammeCurationService;
  let events: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  }, 60000);

  beforeEach(() => {
    events = { emit: jest.fn().mockResolvedValue(undefined) };
    svc = new ProgrammeCurationService(prisma as any, events);
  });

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `cur${Date.now()}_${(seq += 1)}`;

  const mkProvider = (status: any = 'PENDING') =>
    prisma.educationProvider.create({ data: { name: `Uni ${stamp()}`, providerType: 'UNIVERSITY', status } as any });

  const mkProgramme = (providerId: string, extra: any = {}) =>
    prisma.educationProgramme.create({
      data: { providerId, name: `Prog ${stamp()}`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7', ...extra } as any,
    });

  /** Minimal Contact → Lead → Case → AdmissionApplication → choice chain. */
  async function mkStudentHold(programmeId: string) {
    const contact = await prisma.contact.create({ data: { fullName: `Student ${stamp()}` } as any });
    const lead = await prisma.lead.create({ data: { contactId: contact.id } as any });
    const kase = await prisma.case.create({ data: { leadId: lead.id, inzApplicationNumber: `INZ-${stamp()}` } as any });
    const app = await prisma.admissionApplication.create({
      data: { caseId: kase.id, contactId: contact.id } as any,
    });
    await prisma.admissionProgrammeChoice.create({
      data: { admissionApplicationId: app.id, programmeId, intakeMonth: 2, intakeYear: 2027, priority: 1 } as any,
    });
    return { contact, kase };
  }

  // ── the toggle ───────────────────────────────────────────────────────────
  it('Active sets both gates the matching engine reads', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id);
    expect(g.reviewStatus).toBe('PENDING');
    expect(g.isActive).toBe(false);

    await svc.setActivation(g.id, { active: true }, 'owner-1');

    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.reviewStatus).toBe('APPROVED');
    expect(after!.isActive).toBe(true);
  });

  it('Inactive returns to PENDING, never REJECTED', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id, { reviewStatus: 'APPROVED', isActive: true });

    await svc.setActivation(g.id, { active: false }, 'owner-1');

    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.reviewStatus).toBe('PENDING');
    expect(after!.isActive).toBe(false);
  });

  it('warns — and refuses — when a student already holds the programme', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id, { reviewStatus: 'APPROVED', isActive: true });
    const { contact, kase } = await mkStudentHold(g.id);

    await expect(svc.setActivation(g.id, { active: false }, 'owner-1')).rejects.toThrow(ConflictException);

    // and the programme is untouched — not silently switched off
    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.isActive).toBe(true);

    // the refusal names who is affected, so the Owner can go and look
    try {
      await svc.setActivation(g.id, { active: false }, 'owner-1');
    } catch (e: any) {
      expect(e.response.details.code).toBe('CONFIRMATION_REQUIRED');
      expect(e.response.details.affected[0].studentName).toBe(contact.fullName);
      expect(e.response.details.affected[0].caseReference).toBe(kase.inzApplicationNumber);
      expect(e.response.details.retryWith).toEqual({ active: false, confirm: true });
    }
  });

  it('goes through once the Owner confirms, and records that it was confirmed', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id, { reviewStatus: 'APPROVED', isActive: true });
    await mkStudentHold(g.id);

    await svc.setActivation(g.id, { active: false, confirm: true }, 'owner-1');

    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.isActive).toBe(false);
    const [type, , , , , actor, payload] = events.emit.mock.calls.at(-1);
    expect(type).toBe('PROGRAMME_DEACTIVATED');
    expect(actor).toBe('owner-1');
    expect(payload.confirmed).toBe(true);
    expect(payload.affectedStudentChoices).toBe(1);
  });

  it('never gates activation, even with a student holding it', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id);
    await mkStudentHold(g.id);
    await expect(svc.setActivation(g.id, { active: true }, 'owner-1')).resolves.toBeTruthy();
  });

  it('explains why an Active programme is still not reaching students', async () => {
    const pending = await mkProvider('PENDING');
    const g1 = await mkProgramme(pending.id);
    const r1 = await svc.setActivation(g1.id, { active: true }, 'owner-1');
    expect(r1.warning).toMatch(/not marked as under contract/);

    const active = await mkProvider('ACTIVE');
    const g2 = await mkProgramme(active.id);
    const r2 = await svc.setActivation(g2.id, { active: true }, 'owner-1');
    expect(r2.warning).toBeNull();
  });

  // ── direct edit ──────────────────────────────────────────────────────────
  it('saves a direct edit immediately and audits only what changed', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id, { campusCity: 'Auckland', tuitionFeeNZD: 22000 });

    const res = await svc.updateProgramme(
      g.id, { name: g.name, campusCity: 'Auckland', tuitionFeeNZD: 24500 } as any, 'owner-1',
    );

    expect(res.changed).toEqual(['tuitionFeeNZD']);
    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.tuitionFeeNZD).toBe(24500);
    expect(after!.campusCity).toBe('Auckland');

    const [type, , , , , actor, payload] = events.emit.mock.calls.at(-1);
    expect(type).toBe('PROGRAMME_EDITED');
    expect(actor).toBe('owner-1');
    expect(payload.changed).toEqual({ tuitionFeeNZD: { from: 22000, to: 24500 } });
  });

  it('an untouched save writes nothing and audits nothing', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id, { campusCity: 'Dunedin' });
    const res = await svc.updateProgramme(g.id, { campusCity: 'Dunedin' } as any, 'owner-1');
    expect(res.changed).toEqual([]);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('clears a field when the Owner empties it', async () => {
    const p = await mkProvider();
    const g = await mkProgramme(p.id, { otherRequirements: 'Portfolio required' });
    await svc.updateProgramme(g.id, { otherRequirements: '' } as any, 'owner-1');
    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.otherRequirements).toBeNull();
  });

  it('the edit path cannot reach the visibility or provenance fields', async () => {
    const p = await mkProvider();
    // NOT a realistic "ITP:rowN" value on purpose: the local fixture-purge
    // script protects any provider owning an imported-looking programme, so a
    // test using a real-shaped sourceRef would make its own debris unpurgeable.
    const g = await mkProgramme(p.id, { sourceRef: 'TEST-FIXTURE:row12', reviewStatus: 'PENDING' });

    // Even if a caller hand-crafts these, they are not in UpdateProgrammeDto, so
    // ValidationPipe(whitelist) strips them. Here we assert the service itself
    // ignores anything outside the diff of known columns.
    await svc.updateProgramme(g.id, { reviewStatus: 'APPROVED', isActive: true, sourceRef: 'HACKED' } as any, 'owner-1');

    const after = await prisma.educationProgramme.findUnique({ where: { id: g.id } });
    expect(after!.sourceRef).toBe('TEST-FIXTURE:row12');
    expect(after!.reviewStatus).toBe('PENDING');
    expect(after!.isActive).toBe(false);
  });

  // ── the list the screen renders ──────────────────────────────────────────
  it('lists an institution with its subject areas and student-hold counts', async () => {
    const p = await mkProvider();
    const a = await mkProgramme(p.id, { subjectAreaRaw: 'Business' });
    await mkProgramme(p.id, { subjectAreaRaw: 'Business' });
    await mkProgramme(p.id, { subjectAreaRaw: null });
    await mkStudentHold(a.id);

    const out = await svc.listForProvider(p.id);
    expect(out.provider.id).toBe(p.id);
    expect(out.programmes).toHaveLength(3);
    expect(out.subjectAreas).toEqual([
      { label: 'Business', count: 2 },
      { label: 'Unspecified', count: 1 },
    ]);
    expect(out.programmes.find((x: any) => x.id === a.id)!.studentHolds).toBe(1);
  });

  // ── access control (layer 2) ─────────────────────────────────────────────
  it('every curation route is OWNER/SUPER_ADMIN only', () => {
    const proto = ProvidersController.prototype as any;
    for (const handler of ['curationList', 'editProgramme', 'setProgrammeActivation', 'setProgrammeActivationBulk']) {
      expect(Reflect.getMetadata(ROLES_KEY, proto[handler])).toEqual(['OWNER', 'SUPER_ADMIN']);
    }
    // the thumbnail upload this screen reuses is gated the same way
    expect(Reflect.getMetadata(ROLES_KEY, proto.setProgrammeCoverImage)).toEqual(['OWNER', 'SUPER_ADMIN']);
  });
});
