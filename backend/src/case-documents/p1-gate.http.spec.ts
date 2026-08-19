import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';

jest.mock('sanitize-html', () => ({ __esModule: true, default: (s: string) => s }));

// PR-CHECKLIST item 7 — proving the P1/P2 gate REJECTS A REAL ATTEMPT.
//
// A unit test on p1GateVerdict() would show the rule is right; it would not show
// the rule is reachable. The failure mode that matters is a gate that is
// correct and simply never consulted, which is indistinguishable from no gate at
// all. So this drives real multipart POSTs at the two real client upload routes
// through the real controllers and services, and asserts on both the HTTP
// response AND on the row count — a 403 that still wrote the document would be a
// worse outcome than no gate, and only a measured delta rules that out.
//
// Auth guards are forced open and pinned to a seeded student, for the reason the
// EICAR matrix documents: with guards live, a fixture problem answers 401 and a
// "not 2xx" assertion passes without the gate ever running. The scanner is
// stubbed because it sits BEHIND the gate — a blocked upload must never reach
// it, and the allowed control must not need clamd to prove the gate opened.

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% gate\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

jest.setTimeout(300_000);

interface Ids {
  studentUserId: string; staffUserId: string; contactId: string; leadId: string;
  caseId: string; admissionId: string; visaAppId: string;
}

async function seed(prisma: PrismaClient): Promise<Ids> {
  const t = 'P1GATE-' + randomBytes(4).toString('hex');
  const student = await prisma.user.create({
    data: { name: `${t} student`, email: `${t}-stu@test.local`, role: 'STUDENT', isActive: true }, select: { id: true },
  });
  const staff = await prisma.user.create({
    data: { name: `${t} lia`, email: `${t}-lia@test.local`, role: 'LIA', isActive: true }, select: { id: true },
  });
  const contact = await prisma.contact.create({
    data: { fullName: `${t} client`, email: `${t}@test.local`, userId: student.id }, select: { id: true },
  });
  const lead = await prisma.lead.create({ data: { contactId: contact.id }, select: { id: true } });
  const kase = await prisma.case.create({ data: { leadId: lead.id, consultantId: staff.id }, select: { id: true } });
  const admission = await prisma.admissionApplication.create({
    data: { caseId: kase.id, contactId: contact.id }, select: { id: true },
  });
  const visaApp = await prisma.visaApplication.create({
    data: { applicationId: admission.id }, select: { id: true },
  });
  return {
    studentUserId: student.id, staffUserId: staff.id, contactId: contact.id, leadId: lead.id,
    caseId: kase.id, admissionId: admission.id, visaAppId: visaApp.id,
  };
}

async function cleanup(prisma: PrismaClient, ids: Ids) {
  const d = (p: Promise<any>) => p.catch(() => undefined);
  await d(prisma.caseDocumentReview.deleteMany({ where: { caseId: ids.caseId } }));
  await d(prisma.auditLog.deleteMany({ where: { userId: { in: [ids.studentUserId, ids.staffUserId] } } }));
  await d(prisma.admissionDocument.deleteMany({ where: { admissionApplicationId: ids.admissionId } }));
  await d(prisma.visaSupportingDocumentFile.deleteMany({ where: { document: { visaApplicationId: ids.visaAppId } } }));
  await d(prisma.visaSupportingDocument.deleteMany({ where: { visaApplicationId: ids.visaAppId } }));
  await d(prisma.visaApplication.deleteMany({ where: { id: ids.visaAppId } }));
  await d(prisma.admissionApplication.deleteMany({ where: { id: ids.admissionId } }));
  await d(prisma.case.deleteMany({ where: { id: ids.caseId } }));
  await d(prisma.lead.deleteMany({ where: { id: ids.leadId } }));
  await d(prisma.contact.deleteMany({ where: { id: ids.contactId } }));
  await d(prisma.user.deleteMany({ where: { id: { in: [ids.studentUserId, ids.staffUserId] } } }));
}

describe('the P1/P2 gate blocks a real client upload (PR-CHECKLIST item 7)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ids: Ids;
  let uploadDir: string;

  const admissionDocs = () => prisma.admissionDocument.count({ where: { admissionApplicationId: ids.admissionId } });
  const visaDocs = () => prisma.visaSupportingDocument.count({ where: { visaApplicationId: ids.visaAppId } });

  const postAdmission = (documentType: string) =>
    request(app.getHttpServer())
      .post('/students/me/admission/documents')
      .field('documentType', documentType)
      .attach('file', PDF, { filename: 'doc.pdf', contentType: 'application/pdf' });

  const postVisaSupporting = (documentType: string) =>
    request(app.getHttpServer())
      .post(`/students/me/visa/supporting-documents/${documentType}/file`)
      .attach('file', PDF, { filename: 'doc.pdf', contentType: 'application/pdf' });

  /** Record a real LIA verdict on the client's P1 document. */
  async function review(sourceRowId: string, status: 'APPROVED' | 'REJECTED') {
    await prisma.caseDocumentReview.upsert({
      where: { source_sourceRowId: { source: 'ADMISSION', sourceRowId } },
      create: {
        caseId: ids.caseId, source: 'ADMISSION', sourceRowId, status,
        reasonEncrypted: Buffer.from('reviewed during the gate test'), reviewedById: ids.staffUserId,
      },
      update: { status },
    });
  }

  beforeAll(async () => {
    uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'p1-gate-'));
    process.env.UPLOAD_DIR = uploadDir;

    prisma = new PrismaClient();
    await prisma.$connect();
    ids = await seed(prisma);

    const allow = {
      canActivate: (ctx: any) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = { userId: ids.studentUserId, sub: ids.studentUserId, role: 'STUDENT', secondaryRoles: [] };
        return true;
      },
    };

    const { AppModule } = await import('../app.module');
    const { JwtAuthGuard } = await import('../auth/guards/jwt-auth.guard');
    const { RolesGuard } = await import('../auth/guards/roles.guard');
    const { EngagementPaidGuard } = await import('../common/guards/engagement-paid.guard');
    const { UploadScanService } = await import('../common/antivirus/upload-scan.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(JwtAuthGuard).useValue(allow)
      .overrideGuard(RolesGuard).useValue(allow)
      .overrideGuard(EngagementPaidGuard).useValue(allow)
      // Behind the gate by design — stubbed so a blocked upload proves the gate
      // stopped it, not the scanner.
      .overrideProvider(UploadScanService).useValue({ scanOrReject: async () => undefined })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      transformOptions: { enableImplicitConversion: true },
    }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) { await cleanup(prisma, ids); await prisma.$disconnect(); }
    if (uploadDir) await fs.promises.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
  });

  // The order here is the client's actual journey, so each step's precondition
  // is the previous step's real outcome rather than a hand-set fixture.

  it('1. refuses a Priority-2 upload from a client with no documents yet', async () => {
    const before = await admissionDocs();
    const res = await postAdmission('VISA_POLICE_CERTIFICATE');

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('educational documents');
    // Nothing written — the refusal is not a 403 with a side effect.
    expect(await admissionDocs()).toBe(before);
    expect(fs.readdirSync(uploadDir)).toHaveLength(0);
  });

  it('2. allows the Priority-1 upload that opens the path', async () => {
    const res = await postAdmission('PASSPORT');
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(await admissionDocs()).toBe(1);
  });

  it('3. still refuses Priority-2 while that P1 is unreviewed', async () => {
    // The gate is about VERIFIED, not merely uploaded — this is the step a
    // "has the client sent anything?" implementation would get wrong.
    const before = await admissionDocs();
    const res = await postAdmission('VISA_POLICE_CERTIFICATE');

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('still being verified');
    expect(await admissionDocs()).toBe(before);
  });

  it('4. refuses Priority-2 when the P1 was rejected, and says so', async () => {
    const doc = await prisma.admissionDocument.findFirstOrThrow({
      where: { admissionApplicationId: ids.admissionId, documentType: 'PASSPORT' }, select: { id: true },
    });
    await review(doc.id, 'REJECTED');

    const res = await postAdmission('VISA_POLICE_CERTIFICATE');
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('not accepted');
  });

  it('5. lets the client re-upload the rejected P1 — the only way out', async () => {
    // A gate with no exit would strand the client permanently.
    const res = await postAdmission('PASSPORT');
    expect(res.status).toBeLessThan(300);
  });

  it('6. opens once every P1 is approved', async () => {
    const docs = await prisma.admissionDocument.findMany({
      where: { admissionApplicationId: ids.admissionId, documentType: 'PASSPORT' }, select: { id: true },
    });
    for (const d of docs) await review(d.id, 'APPROVED');

    const before = await admissionDocs();
    const res = await postAdmission('VISA_POLICE_CERTIFICATE');
    expect(res.status).toBeLessThan(300);
    expect(await admissionDocs()).toBe(before + 1);   // it really was stored this time
  });

  it('7. gates the visa supporting-document surface by the same rule', async () => {
    // Re-close the gate by rejecting a P1, then try the OTHER upload route.
    const p1 = await prisma.admissionDocument.findFirstOrThrow({
      where: { admissionApplicationId: ids.admissionId, documentType: 'PASSPORT' }, select: { id: true },
    });
    await review(p1.id, 'REJECTED');

    const before = await visaDocs();
    const blocked = await postVisaSupporting('MILITARY_RECORD');   // P2
    expect(blocked.status).toBe(403);
    expect(await visaDocs()).toBe(before);

    // PASSPORT is P1 on this surface too, so it must remain open.
    const allowed = await postVisaSupporting('PASSPORT');
    expect(allowed.status).toBeLessThan(300);
  });
});
