/**
 * PR-OWNER-DOCS — listAllDocumentsAcrossCases: the 5-role access matrix +
 * case scoping + the System-A "Other" bucket. DB-backed (real Prisma, throwaway
 * DB), crypto stubbed.
 */

import { PrismaClient } from '@prisma/client';
import { CaseDocumentsService } from './case-documents.service';

jest.setTimeout(60000);

describe('listAllDocumentsAcrossCases — access matrix + scoping + Other bucket', () => {
  let prisma: PrismaClient;
  let svc: CaseDocumentsService;

  // Seeded fixture handles.
  let caseId: string;
  let owner: string, lia: string, admOfficer: string, clientOfficer: string, strangerOfficer: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new CaseDocumentsService(prisma as any, {} as any);

    const s = `cd${Date.now()}`;
    const mkUser = (role: string, tag: string) =>
      prisma.user.create({ data: { name: `${role} ${tag}`, email: `${tag}.${s}@t.local`, passwordHash: 'x', role: role as any, isActive: true } });

    owner = (await mkUser('OWNER', 'owner')).id;
    lia = (await mkUser('LIA', 'lia')).id;
    admOfficer = (await mkUser('CONSULTANT', 'adm')).id;
    clientOfficer = (await mkUser('CLIENT_CONSULTANT', 'co')).id;
    strangerOfficer = (await mkUser('CONSULTANT', 'stranger')).id;
    const clientUser = await mkUser('LEAD', 'client');

    const contact = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `client.${s}@t.local`, userId: clientUser.id } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'NEW' } });
    // Case assigned to the Admission Officer (ownerId) + Client Officer (consultantId).
    const kase = await prisma.case.create({ data: { leadId: lead.id, ownerId: admOfficer, consultantId: clientOfficer } });
    caseId = kase.id;

    // ── ADMISSION source: one P1 (PASSPORT) + one P2 (VISA_POLICE_CERTIFICATE) ──
    const admApp = await prisma.admissionApplication.create({ data: { caseId, contactId: contact.id } });
    const admDoc = (documentType: string) =>
      prisma.admissionDocument.create({
        data: { admissionApplicationId: admApp.id, documentType: documentType as any, fileName: `${documentType}.pdf`, fileUrl: `r2://${documentType}`, mimeType: 'application/pdf', fileSizeBytes: 10 },
      });
    await admDoc('PASSPORT');                 // P1
    await admDoc('VISA_POLICE_CERTIFICATE');  // P2

    // ── VISA_SUPPORTING source: a P1-TYPED doc (OFFER_OF_PLACE) in the visa file ──
    const visaApp = await prisma.visaApplication.create({ data: { applicationId: admApp.id } });
    const vsd = await prisma.visaSupportingDocument.create({ data: { visaApplicationId: visaApp.id, documentType: 'OFFER_OF_PLACE' as any } });
    await prisma.visaSupportingDocumentFile.create({ data: { visaSupportingDocumentId: vsd.id, originalFilename: 'offer.pdf', mimeType: 'application/pdf', sizeBytes: 10, fileUrl: 'r2://offer' } });

    // ── System-A generic Document (signed contract) ──
    await prisma.document.create({
      data: { caseId, uploaderId: clientUser.id, r2Key: `r2key-${s}`, originalName: 'engagement.pdf', mimeType: 'application/pdf', sizeBytes: 10, status: 'UPLOADED', category: 'signed_contract' },
    });
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  // Rows this actor sees ON THE SEEDED CASE (filter out any cross-spec noise).
  async function onCase(actor: { id: string; role: string }) {
    const rows = await svc.listAllDocumentsAcrossCases({ id: actor.id, name: null, role: actor.role });
    return rows.filter((r) => r.caseId === caseId);
  }
  const sources = (rows: any[]) => rows.map((r) => `${r.source}:${r.docType}`).sort();

  it('Owner sees ALL: both admission docs + visa + System-A Other', async () => {
    const rows = await onCase({ id: owner, role: 'OWNER' });
    expect(sources(rows)).toEqual([
      'ADMISSION:PASSPORT',
      'ADMISSION:VISA_POLICE_CERTIFICATE',
      'OTHER:signed_contract',
      'VISA_SUPPORTING:OFFER_OF_PLACE',
    ]);
  });

  it('LIA sees all structured incl. visa, but NOT the System-A Other bucket', async () => {
    const rows = await onCase({ id: lia, role: 'LIA' });
    expect(sources(rows)).toEqual([
      'ADMISSION:PASSPORT',
      'ADMISSION:VISA_POLICE_CERTIFICATE',
      'VISA_SUPPORTING:OFFER_OF_PLACE',
    ]);
    expect(rows.some((r) => r.bucket === 'OTHER')).toBe(false);
  });

  it('Admission Officer (CONSULTANT, assigned) sees P1 non-visa ONLY', async () => {
    const rows = await onCase({ id: admOfficer, role: 'CONSULTANT' });
    expect(sources(rows)).toEqual(['ADMISSION:PASSPORT']); // P1 only; no P2, no visa, no Other
    expect(rows[0].priority).toBe('P1');
  });

  it('Client Officer (CLIENT_CONSULTANT, assigned) sees P1+P2 non-visa, NOT visa', async () => {
    const rows = await onCase({ id: clientOfficer, role: 'CLIENT_CONSULTANT' });
    expect(sources(rows)).toEqual([
      'ADMISSION:PASSPORT',
      'ADMISSION:VISA_POLICE_CERTIFICATE',
    ]);
    expect(rows.some((r) => r.source === 'VISA_SUPPORTING')).toBe(false);
    expect(rows.some((r) => r.bucket === 'OTHER')).toBe(false);
  });

  it('an UNASSIGNED Admission Officer sees NOTHING on this case (assignment scoping)', async () => {
    const rows = await onCase({ id: strangerOfficer, role: 'CONSULTANT' });
    expect(rows).toHaveLength(0);
  });
});
