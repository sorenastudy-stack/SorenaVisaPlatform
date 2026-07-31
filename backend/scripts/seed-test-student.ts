import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient, type InstitutionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { assignPrioritySlots, type SlotRule } from '../src/matching/matching.logic';

// QA seed — one test STUDENT already PAST the account-opening payment gate, with a
// populated recommendation list + auto-suggested priority slots, so the
// Apply/Study surface (PR-RECS-1/2) can be demoed in a realistic state.
//
// Idempotent: keyed by the test email; re-running updates rather than duplicates.
// Institutions are FICTIONAL ("(demo)") — no real-provider impersonation.
//
//   npx ts-node scripts/seed-test-student.ts

const prisma = new PrismaClient();

const EMAIL = 'test.client@sorena.test';
const PASSWORD = 'TestStudent#2026';
const NAME = 'Test Client (Demo)';

// Fictional providers + programmes (2 University, 1 ITP, 2 PTE) → a valid 5-slot slate.
const PROVIDERS: Array<{ name: string; type: InstitutionType; providerType: any; city: string; programmes: string[] }> = [
  { name: 'Aotearoa University (demo)',            type: 'UNIVERSITY', providerType: 'UNIVERSITY', city: 'Auckland',   programmes: ['Bachelor of Information Technology', 'Bachelor of Business'] },
  { name: 'Kauri Institute of Technology (demo)',  type: 'ITP',        providerType: 'POLYTECHNIC', city: 'Hamilton',   programmes: ['New Zealand Diploma in Engineering'] },
  { name: 'Harbour College (demo)',                type: 'PTE',        providerType: 'COLLEGE',     city: 'Wellington', programmes: ['Diploma in Business Administration', 'Certificate in Hospitality Management'] },
];

// Rank order → drives assignPrioritySlots to a valid slate (1,2=Uni · 3=PTE · 4=ITP · 5=PTE).
const RANKING: Array<{ provider: string; programme: string; fitScore: number; type: InstitutionType }> = [
  { provider: 'Aotearoa University (demo)',           programme: 'Bachelor of Information Technology', fitScore: 0.82, type: 'UNIVERSITY' },
  { provider: 'Aotearoa University (demo)',           programme: 'Bachelor of Business',               fitScore: 0.74, type: 'UNIVERSITY' },
  { provider: 'Harbour College (demo)',               programme: 'Certificate in Hospitality Management', fitScore: 0.68, type: 'PTE' },
  { provider: 'Kauri Institute of Technology (demo)', programme: 'New Zealand Diploma in Engineering',  fitScore: 0.63, type: 'ITP' },
  { provider: 'Harbour College (demo)',               programme: 'Diploma in Business Administration',  fitScore: 0.58, type: 'PTE' },
];

async function main() {
  // 1. User (STUDENT) with a login password.
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { role: 'STUDENT', isActive: true, name: NAME, passwordHash },
    create: { email: EMAIL, name: NAME, role: 'STUDENT', isActive: true, passwordHash },
    select: { id: true },
  });

  // 2. Contact → Lead → Case chain.
  const contact = await upsertBy(
    () => prisma.contact.findFirst({ where: { userId: user.id } }),
    () => prisma.contact.create({ data: { fullName: NAME, userId: user.id, nationality: 'IR' } }),
  );
  const lead = await upsertBy(
    () => prisma.lead.findFirst({ where: { contactId: contact.id } }),
    () => prisma.lead.create({ data: { contactId: contact.id } }),
  );
  const kase = await upsertBy(
    () => prisma.case.findFirst({ where: { leadId: lead.id } }),
    () => prisma.case.create({ data: { leadId: lead.id } }),
  );

  // 3. PAID engagement invoice — the gate looks for ENG-<caseId> with status PAID.
  const engNumber = `ENG-${kase.id}`;
  await prisma.invoice.upsert({
    where: { invoiceNumber: engNumber },
    update: { status: 'PAID' },
    create: { invoiceNumber: engNumber, caseId: kase.id, contactId: contact.id, description: 'Engagement fee (account opening) — test', amount: 200 as any, status: 'PAID' },
  });

  // 4. Admission application (the portal resolves the case via this).
  await upsertBy(
    () => prisma.admissionApplication.findFirst({ where: { caseId: kase.id } }),
    () => prisma.admissionApplication.create({ data: { caseId: kase.id, contactId: contact.id } }),
  );

  // 5. Approved providers + programmes.
  const progId: Record<string, string> = {};
  for (const p of PROVIDERS) {
    const prov = await upsertBy(
      () => prisma.educationProvider.findFirst({ where: { name: p.name } }),
      () => prisma.educationProvider.create({ data: { name: p.name, providerType: p.providerType, institutionType: p.type, status: 'ACTIVE', city: p.city, country: 'NZ' } }),
    );
    // keep type/status correct on re-run
    await prisma.educationProvider.update({ where: { id: prov.id }, data: { institutionType: p.type, status: 'ACTIVE' } });
    for (const name of p.programmes) {
      const prog = await upsertBy(
        () => prisma.educationProgramme.findFirst({ where: { providerId: prov.id, name } }),
        () => prisma.educationProgramme.create({ data: { providerId: prov.id, name, level: 'BACHELOR', nzqfLevel: 'LEVEL_7', reviewStatus: 'APPROVED', isActive: true, tuitionFeeNZD: 24000, currency: 'NZD', durationMonths: 36, intakeMonths: [2, 7] } }),
      );
      await prisma.educationProgramme.update({ where: { id: prog.id }, data: { reviewStatus: 'APPROVED', isActive: true } });
      progId[`${p.name}::${name}`] = prog.id;
    }
  }

  // 6. Recommendation list (VIEWED = reviewed) + ranked items. Reset any prior one.
  await prisma.recommendationList.deleteMany({ where: { caseId: kase.id } }); // clears items + slots via cascade
  const list = await prisma.recommendationList.create({
    data: { caseId: kase.id, status: 'VIEWED', criteriaSource: 'SCORECARD', criteriaJson: { note: 'demo — reverse-mapped from scorecard', qualificationFieldId: null } },
  });
  let rank = 1;
  for (const r of RANKING) {
    await prisma.recommendationItem.create({
      data: { recommendationListId: list.id, programmeId: progId[`${r.provider}::${r.programme}`], rank: rank++, fitScore: r.fitScore, institutionType: r.type, whyJson: [{ dim: 'field', verdict: 'aligns', detail: 'Open to your background.' }] },
    });
  }

  // 7. Pre-seed the auto-suggested priority slots (what the picker shows on open).
  const cfg = await prisma.countryExecutionConfig.findUnique({ where: { countryCode: 'NZ' } });
  if (cfg) {
    const items = await prisma.recommendationItem.findMany({ where: { recommendationListId: list.id }, orderBy: { rank: 'asc' }, select: { programmeId: true, institutionType: true } });
    const assigned = assignPrioritySlots(items.map((i) => ({ programmeId: i.programmeId, institutionType: i.institutionType })), cfg.slotRules as unknown as SlotRule[], cfg.slotCount);
    await prisma.prioritySlot.createMany({ data: assigned.map((s) => ({ recommendationListId: list.id, position: s.position, programmeId: s.programmeId })) });
  }

  console.log('\n=== TEST STUDENT READY ===');
  console.log('  Environment : LOCAL DEV (your machine)');
  console.log('  Portal URL  : http://localhost:3000/login  → then /student');
  console.log('  Email       :', EMAIL);
  console.log('  Password    :', PASSWORD);
  console.log('  Case id     :', kase.id, '(engagement fee PAID → portal unlocked)');
  console.log('  Recommends  :', RANKING.length, 'programmes ·', cfg ? '5 priority slots pre-filled' : '(no NZ config — slots seed on first open)');
  console.log('  Run servers : backend `npm run start:dev` (:3001) + frontend `npm run dev` (:3000)\n');
  await prisma.$disconnect();
}

// Tiny find-or-create helper (idempotent seeds).
async function upsertBy<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  return (await find()) ?? (await create());
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
