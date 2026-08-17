import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';

jest.mock('sanitize-html', () => ({ __esModule: true, default: (s: string) => s }));

// PR-AV slice 2 — the route matrix.
//
// This REPLACES the slice-1 pinning test, which only asserted that
// portal.service.ts was the sole caller of the scanner. That test could tell
// you a second caller had appeared; it could not tell you whether any caller
// actually rejected anything. With 22 upload routes the interesting question
// changed from "who calls it" to "does every route refuse a malicious file",
// and only driving real HTTP answers that.
//
// Every named route is exercised with the real EICAR test string through the
// real controller → real service → real UploadScanService → real
// AntivirusService, over the real INSTREAM protocol. The only substitution is
// clamd itself: a local TCP server that speaks the protocol and answers FOUND
// for EICAR, OK otherwise. Substituting the verdict source rather than the
// scanner keeps the parsing, framing and fail-closed logic under test.
//
// Two design decisions worth knowing:
//
//   1. AUTH GUARDS ARE FORCED OPEN. This is not laziness — it is what makes the
//      assertions meaningful. If the guards ran, a route with mis-seeded
//      fixtures would answer 401/403, and a test asserting merely "not 2xx"
//      would pass while never reaching the scanner at all. With the guards open
//      the only thing that can produce the malware rejection is the scan path.
//
//   2. THE ASSERTION IS EXACT. Status 422 AND the precise user-facing sentence.
//      "Some 4xx" would be satisfied by a validation error, a missing fixture,
//      or a route that 404s because its path changed — the three ways this test
//      could rot into a false pass.
//
// A route that cannot be exercised FAILS. It is never skipped: an unexercisable
// route is exactly the signal that something needs different treatment (the R2
// presigned flow, say), and a silent skip would bury it.

// The 68-byte industry-standard antivirus test string, assembled at runtime so
// this source file is not itself a scanner trigger. Harmless by construction.
const EICAR = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join(''),
  'ascii',
);

const INFECTED_MESSAGE = 'This file could not be uploaded. Please try a different file.';

/** A local clamd that speaks INSTREAM for real and looks for EICAR. */
function startFakeClamd(): Promise<{ port: number; close: () => Promise<void>; scans: number }> {
  const state = { scans: 0 };
  const server = net.createServer((sock) => {
    const chunks: Buffer[] = [];
    let handshake = false;
    sock.on('data', (d: Buffer) => {
      chunks.push(d);
      const buf = Buffer.concat(chunks);
      if (!handshake && buf.length >= 10) handshake = true;
      // Terminated by a trailing 4-byte zero length.
      if (buf.length >= 4 && buf.readUInt32BE(buf.length - 4) === 0) {
        state.scans += 1;
        // Reassemble the framed payload so detection is on content, not on the
        // wire bytes — the same thing real clamd does.
        let off = 10;
        const parts: Buffer[] = [];
        while (off + 4 <= buf.length) {
          const len = buf.readUInt32BE(off);
          if (len === 0) break;
          parts.push(buf.subarray(off + 4, off + 4 + len));
          off += 4 + len;
        }
        const body = Buffer.concat(parts);
        const infected = body.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'));
        sock.write(infected ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
        sock.end();
      }
    });
    sock.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        get scans() { return state.scans; },
        close: () => new Promise<void>((r) => server.close(() => r())),
      } as any);
    });
  });
}

/** Every upload route this slice covers. Hardcoded on purpose — see below. */
interface RouteCase {
  name: string;
  method: 'post';
  /** Built after seeding, so ids can be substituted in. */
  url: (ids: Ids) => string;
  /** Extra multipart fields some routes require before they reach the scan. */
  fields?: Record<string, string>;
  filename: string;
  mime: string;
}

interface Ids {
  caseId: string;
  visaStageCaseId: string;
  liaUserId: string;
  studentUserId: string;
  staffUserId: string;
  providerId: string;
  programmeId: string;
  ticketId: string;
  invoiceId: string;
  evidenceEntryId: string;
}

const ROUTES: RouteCase[] = [
  { name: 'case visa document',            method: 'post', url: (i) => `/cases/${i.caseId}/visa/issue`,
    fields: { visaStartDate: '2030-01-01', visaEndDate: '2031-01-01' }, filename: 'visa.pdf', mime: 'application/pdf' },
  { name: 'student visa — supporting doc', method: 'post', url: () => '/students/me/visa/supporting-documents/PASSPORT/file',
    filename: 'passport.pdf', mime: 'application/pdf' },
  { name: 'student visa — other evidence', method: 'post', url: (i) => `/students/me/visa/supporting-documents-2/other-evidence/${i.evidenceEntryId}/file`,
    filename: 'evidence.pdf', mime: 'application/pdf' },
  { name: 'admission document',            method: 'post', url: () => '/students/me/admission/documents',
    fields: { documentType: 'PASSPORT' }, filename: 'admission.pdf', mime: 'application/pdf' },
  { name: 'INZ receipt',                   method: 'post', url: (i) => `/cases/${i.visaStageCaseId}/inz-submission`,
    fields: { submittedAt: '2030-01-01', inzApplicationNumber: 'AV-TEST-1' }, filename: 'inz.pdf', mime: 'application/pdf' },
  { name: 'HR contract',                   method: 'post', url: (i) => `/api/staff/users/${i.staffUserId}/contract`,
    filename: 'contract.pdf', mime: 'application/pdf' },
  { name: 'LIA licence file',              method: 'post', url: () => '/staff/lia-profile/me/licence-file',
    filename: 'licence.pdf', mime: 'application/pdf' },
  { name: 'ticket attachment',             method: 'post', url: (i) => `/staff/tickets/${i.ticketId}/attachments`,
    filename: 'attach.png', mime: 'image/png' },
  { name: 'staff photo — self',            method: 'post', url: () => '/api/staff/me/photo',
    filename: 'me.png', mime: 'image/png' },
  { name: 'staff photo — admin',           method: 'post', url: (i) => `/api/staff/users/${i.staffUserId}/photo`,
    filename: 'them.png', mime: 'image/png' },
  { name: 'provider marketing file',       method: 'post', url: () => '/provider/marketing',
    filename: 'prospectus.pdf', mime: 'application/pdf' },
  { name: 'provider import — programmes check',   method: 'post', url: () => '/provider/imports/programmes/check',
    filename: 'p.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'provider import — programmes apply',   method: 'post', url: () => '/provider/imports/programmes/apply',
    filename: 'p.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'provider import — tuition check',      method: 'post', url: () => '/provider/imports/tuition/check',
    filename: 't.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'provider import — tuition apply',      method: 'post', url: () => '/provider/imports/tuition/apply',
    filename: 't.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'provider import — scholarships check', method: 'post', url: () => '/provider/imports/scholarships/check',
    filename: 's.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'provider import — scholarships apply', method: 'post', url: () => '/provider/imports/scholarships/apply',
    filename: 's.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'staff import — programmes',     method: 'post', url: (i) => `/providers/${i.providerId}/import-programmes`,
    filename: 'p.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'staff import — scholarships',   method: 'post', url: (i) => `/providers/${i.providerId}/scholarships/import`,
    filename: 's.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'staff import — tuitions',       method: 'post', url: (i) => `/providers/${i.providerId}/tuitions/import`,
    filename: 't.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { name: 'programme cover image',         method: 'post', url: (i) => `/providers/programmes/${i.programmeId}/cover-image`,
    filename: 'cover.png', mime: 'image/png' },
  { name: 'invoice receipt (slice 1)',     method: 'post', url: (i) => `/portal/me/invoices/${i.invoiceId}/receipt`,
    fields: { method: 'bank' }, filename: 'receipt.pdf', mime: 'application/pdf' },
];

jest.setTimeout(300_000);

describe('EICAR is refused on every upload route (PR-AV slice 2)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clamd: { port: number; close: () => Promise<void>; scans: number };
  let ids: Ids;
  let uploadDir: string;
  const r2Puts: string[] = [];

  beforeAll(async () => {
    clamd = await startFakeClamd();
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(clamd.port);
    process.env.CLAMAV_TIMEOUT_MS = '10000';

    // A throwaway upload root, so "did anything get written" is answerable by
    // looking at an empty directory rather than by diffing the real volume.
    uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'av-routes-'));
    process.env.UPLOAD_DIR = uploadDir;

    prisma = new PrismaClient();
    await prisma.$connect();
    ids = await seed(prisma);

    // Guards open — see the header. Also stub R2 so an accepted upload would be
    // recorded here rather than reaching the network; the assertion is that it
    // stays empty.
    const allow = { canActivate: (ctx: any) => { attachActor(ctx, ids); return true; } };
    const { AppModule } = await import('../../app.module');
    const { JwtAuthGuard } = await import('../../auth/guards/jwt-auth.guard');
    const { RolesGuard } = await import('../../auth/guards/roles.guard');
    const { R2Service } = await import('../r2/r2.service');

    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(JwtAuthGuard).useValue(allow)
      .overrideGuard(RolesGuard).useValue(allow)
      .overrideProvider(R2Service).useValue({
        bucketName: 'test',
        putObject: async (key: string) => { r2Puts.push(key); },
        deleteObject: async () => undefined,
        getPresignedUploadUrl: async () => 'https://example.invalid/put',
        getPresignedDownloadUrl: async () => 'https://example.invalid/get',
      });

    // Named explicitly, and imported without a try/catch on purpose. An earlier
    // version looked these up by path inside a try — when one path was wrong the
    // guard silently stayed active and five routes answered 403 instead of ever
    // reaching the scanner. A wrong path here is now an import error, loudly.
    const { CaseAccessGuard } = await import('../../cases/case-access.guard');
    const { EngagementPaidGuard } = await import('../guards/engagement-paid.guard');
    const { ProviderAccessGuard } = await import('../../provider-portal/provider-access.guard');
    const { StaffRolesGuard } = await import('../../staff/roles/staff-roles.guard');
    for (const guard of [CaseAccessGuard, EngagementPaidGuard, ProviderAccessGuard, StaffRolesGuard]) {
      builder.overrideGuard(guard).useValue(allow);
    }

    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    // Mirrors main.ts. Without it @Type(() => Date) never runs and the visa
    // route rejects its own dates before the scan is reached.
    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) { await cleanup(prisma, ids).catch(() => undefined); await prisma.$disconnect(); }
    if (clamd) await clamd.close();
    if (uploadDir) await fs.promises.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('covers every route named in this slice — 22 of them', () => {
    expect(ROUTES).toHaveLength(22);
    // Duplicate names would silently halve the matrix.
    expect(new Set(ROUTES.map((r) => r.name)).size).toBe(22);
  });

  describe.each(ROUTES.map((r) => [r.name, r] as const))('%s', (_name, route) => {
    it('refuses the EICAR file, and stores nothing', async () => {
      const before = await snapshot(prisma, uploadDir);
      const r2Before = r2Puts.length;

      let req = request(app.getHttpServer()).post(route.url(ids));
      for (const [k, v] of Object.entries(route.fields ?? {})) req = req.field(k, v);
      const res = await req.attach('file', EICAR, { filename: route.filename, contentType: route.mime });

      // Exact, not "some 4xx" — a 401/403/404 here would mean the request never
      // reached the scanner and this assertion is the only thing standing
      // between that and a green tick.
      expect({ route: route.name, status: res.status, message: res.body?.message })
        .toEqual({ route: route.name, status: 422, message: INFECTED_MESSAGE });

      // Nothing persisted, by measured delta rather than by inspection.
      const after = await snapshot(prisma, uploadDir);
      expect({ route: route.name, ...after }).toEqual({ route: route.name, ...before });
      expect(r2Puts.length).toBe(r2Before);
    });
  });

  it('a clean file on the same route is still accepted — the gate is the verdict, not the scan', async () => {
    // Guards against the failure where every route "passes" because uploads are
    // broken outright rather than because malware is being detected.
    const clean = Buffer.from('%PDF-1.4\nordinary licence\n%%EOF');
    const res = await request(app.getHttpServer())
      .post('/staff/lia-profile/me/licence-file')
      .attach('file', clean, { filename: 'licence.pdf', contentType: 'application/pdf' });
    expect([200, 201]).toContain(res.status);
  });
});

/** Counts that must not move when an upload is refused. */
async function snapshot(prisma: PrismaClient, uploadDir: string) {
  const [
    visas, supporting, evidence, admissionDocs, contracts, liaProfilesWithFile, invoicesWithReceipt, marketing, casesWithReceipt,
  ] = await Promise.all([
    prisma.visa.count(),
    prisma.visaSupportingDocumentFile.count(),
    prisma.visaOtherEvidenceFile.count(),
    prisma.admissionDocument.count(),
    prisma.staffContract.count(),
    prisma.liaProfile.count({ where: { iaaLicenceFileUrl: { not: null } } }),
    prisma.invoice.count({ where: { receiptFileUrl: { not: null } } }),
    prisma.providerMarketingAsset.count(),
    prisma.case.count({ where: { inzReceiptFileUrl: { not: null } } }),
  ]);
  return {
    visas, supporting, evidence, admissionDocs, contracts, liaProfilesWithFile,
    invoicesWithReceipt, marketing, casesWithReceipt,
    filesOnDisk: await countFiles(uploadDir),
  };
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  const walk = async (d: string) => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else n += 1;
    }
  };
  await walk(dir);
  return n;
}

/**
 * Put the actor the open guards would otherwise have established onto the
 * request. Which actor matters: the student-facing routes resolve their target
 * row FROM the caller (contact → case → application), so handing them a staff
 * user makes them 404 long before the scan. Route-shaped, not one-size.
 */
function attachActor(ctx: any, ids: Ids) {
  const req = ctx.switchToHttp?.().getRequest?.();
  if (!req) return;
  const url: string = req.originalUrl ?? req.url ?? '';
  const asClient = url.startsWith('/students/') || url.startsWith('/portal/');
  const userId = asClient ? ids.studentUserId : ids.staffUserId;
  req.user = {
    userId,
    id: userId,
    role: asClient ? 'STUDENT' : 'OWNER',
    secondaryRoles: [],
    email: 'av-routes@test.local',
  };
  req.providerAccess = { providerId: ids.providerId, providerName: 'AV Test Institution' };
}

const TAG = `avroutes-${process.pid}`;

/**
 * The minimum row graph every route needs to get PAST its own precondition
 * checks and reach the scan. That ordering is deliberate in the services — a
 * file that was never going to be accepted should not be scanned — which means
 * a half-seeded fixture surfaces as a 400/404 here rather than a 422, and the
 * exact-status assertion turns that into a failure instead of a false pass.
 */
async function seed(prisma: PrismaClient): Promise<Ids> {
  const staff = await prisma.user.create({
    data: { name: `${TAG} staff`, email: `${TAG}-staff@test.local`, role: 'OWNER', isActive: true },
    select: { id: true },
  });
  const lia = await prisma.user.create({
    data: { name: `${TAG} lia`, email: `${TAG}-lia@test.local`, role: 'LIA', isActive: true },
    select: { id: true },
  });
  const student = await prisma.user.create({
    data: { name: `${TAG} student`, email: `${TAG}-student@test.local`, role: 'STUDENT', isActive: true },
    select: { id: true },
  });

  // The LIA licence route writes against the CALLING user, which the open guard
  // reports as the staff user — so the profile has to hang off that id.
  await prisma.liaProfile.create({ data: { userId: staff.id } });

  const contact = await prisma.contact.create({
    data: { fullName: `${TAG} client`, email: `${TAG}-client@test.local`, userId: student.id },
    select: { id: true },
  });
  const lead = await prisma.lead.create({ data: { contactId: contact.id }, select: { id: true } });

  // The visa-issue route demands INZ_SUBMITTED; the INZ-receipt route demands
  // VISA. One case cannot satisfy both, so each gets its own — and the ORDER is
  // load-bearing: resolveAdmissionApplication picks the student's newest case,
  // so the one carrying the admission application must be created last.
  const visaStageCase = await prisma.case.create({
    // liaId set because the INZ route refuses an unassigned case before it
    // reaches the scan.
    data: { leadId: lead.id, stage: 'VISA', liaId: lia.id },
    select: { id: true },
  });

  const kase = await prisma.case.create({
    data: { leadId: lead.id, stage: 'INZ_SUBMITTED' },
    select: { id: true },
  });

  const provider = await prisma.educationProvider.create({
    data: { name: `${TAG} Institution`, providerType: 'UNIVERSITY' },
    select: { id: true },
  });
  const programme = await prisma.educationProgramme.create({
    data: { providerId: provider.id, name: `${TAG} Programme`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' },
    select: { id: true },
  });

  const admission = await prisma.admissionApplication.create({
    data: { caseId: kase.id, contactId: contact.id },
    select: { id: true },
  });
  const visaApp = await prisma.visaApplication.create({
    data: { applicationId: admission.id },
    select: { id: true },
  });
  const evidenceEntry = await prisma.visaOtherEvidenceEntry.create({
    data: { visaApplicationId: visaApp.id, evidenceType: 'OTHER' },
    select: { id: true },
  });

  // Tickets hang off VisaCase, a different model from Case — the FK named
  // `caseId` here does NOT point at the case seeded above.
  const visaCase = await prisma.visaCase.create({
    data: { visaApplicationId: visaApp.id, clientId: student.id },
    select: { id: true },
  });

  const ticket = await prisma.visaSupportTicket.create({
    data: {
      clientId: student.id,   // → User, not Contact
      caseId: visaCase.id,
      department: 'DOCUMENTS',
      subjectEncrypted: Buffer.from('av route matrix'),
    },
    select: { id: true },
  });

  const invoice = await prisma.invoice.create({
    data: {
      caseId: kase.id,
      contactId: contact.id,
      invoiceNumber: `${TAG}-1`,
      description: 'av route matrix',
      status: 'SENT',
      amount: 1,
      currency: 'NZD',
      dueDate: new Date(Date.now() + 7 * 86_400_000),
    },
    select: { id: true },
  });

  return {
    caseId: kase.id,
    visaStageCaseId: visaStageCase.id,
    liaUserId: lia.id,
    studentUserId: student.id,
    staffUserId: staff.id,
    providerId: provider.id,
    programmeId: programme.id,
    ticketId: ticket.id,
    invoiceId: invoice.id,
    evidenceEntryId: evidenceEntry.id,
  };
}

async function cleanup(prisma: PrismaClient, ids: Ids): Promise<void> {
  const swallow = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* order-tolerant */ } };
  await swallow(() => prisma.auditLog.deleteMany({ where: { userId: { in: [ids.staffUserId, ids.liaUserId, ids.studentUserId] } } }));
  await swallow(() => prisma.visaSupportTicket.deleteMany({ where: { id: ids.ticketId } }));
  await swallow(() => prisma.visaCase.deleteMany({ where: { clientId: ids.studentUserId } }));
  await swallow(() => prisma.invoice.deleteMany({ where: { id: ids.invoiceId } }));
  await swallow(() => prisma.visaOtherEvidenceFile.deleteMany({ where: { visaOtherEvidenceEntryId: ids.evidenceEntryId } }));
  await swallow(() => prisma.visaOtherEvidenceEntry.deleteMany({ where: { id: ids.evidenceEntryId } }));
  const admissionIds = (await prisma.admissionApplication
    .findMany({ where: { caseId: ids.caseId }, select: { id: true } })
    .catch(() => [] as Array<{ id: string }>)).map((a) => a.id);
  await swallow(() => prisma.visaApplication.deleteMany({ where: { applicationId: { in: admissionIds } } }));
  await swallow(() => prisma.admissionDocument.deleteMany({ where: { admissionApplication: { caseId: ids.caseId } } }));
  await swallow(() => prisma.admissionApplication.deleteMany({ where: { caseId: ids.caseId } }));
  await swallow(() => prisma.visa.deleteMany({ where: { caseId: ids.caseId } }));
  await swallow(() => prisma.providerMarketingAsset.deleteMany({ where: { providerId: ids.providerId } }));
  await swallow(() => prisma.educationProgramme.deleteMany({ where: { providerId: ids.providerId } }));
  await swallow(() => prisma.educationProvider.deleteMany({ where: { id: ids.providerId } }));
  await swallow(() => prisma.staffContract.deleteMany({ where: { userId: { in: [ids.staffUserId, ids.liaUserId] } } }));
  await swallow(() => prisma.liaProfile.deleteMany({ where: { userId: { in: [ids.staffUserId, ids.liaUserId] } } }));
  await swallow(() => prisma.case.deleteMany({ where: { id: { in: [ids.caseId, ids.visaStageCaseId] } } }));
  await swallow(() => prisma.lead.deleteMany({ where: { contact: { userId: ids.studentUserId } } }));
  await swallow(() => prisma.contact.deleteMany({ where: { userId: ids.studentUserId } }));
  await swallow(() => prisma.user.deleteMany({ where: { id: { in: [ids.staffUserId, ids.liaUserId, ids.studentUserId] } } }));
}
