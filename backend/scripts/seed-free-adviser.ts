import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

// PR-BOOKING-3 — local seed: one NON-LIA adviser (CONSULTANT) with weekly
// availability so FREE_15 slots appear, plus a sanity check that the LEAD
// yashoue@gmail.com exists. Idempotent.

const prisma = new PrismaClient();
const TZ = 'Pacific/Auckland';

// Two NON-LIA advisers with the SAME weekly hours → overlapping times have
// capacity 2 (each adviser = 1 seat).
const ADVISERS = [
  { email: 'adviser.free@booking.test',  name: 'Aroha (Consultant)' },
  { email: 'adviser.free2@booking.test', name: 'Manaia (Consultant)' },
];

async function main() {
  // Mon–Fri 09:00–12:00 and 13:00–17:00 (minutes-from-midnight, NZ tz).
  const windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = [];
  for (let dow = 1; dow <= 5; dow++) {
    windows.push({ dayOfWeek: dow, startMinute: 540, endMinute: 720 });
    windows.push({ dayOfWeek: dow, startMinute: 780, endMinute: 1020 });
  }

  for (const a of ADVISERS) {
    const adviser = await prisma.user.upsert({
      where: { email: a.email },
      update: { role: 'CONSULTANT', isActive: true, name: a.name },
      create: { email: a.email, name: a.name, role: 'CONSULTANT', isActive: true },
      select: { id: true, name: true, role: true },
    });
    await prisma.staffAvailability.deleteMany({ where: { staffId: adviser.id } });
    await prisma.staffAvailability.createMany({
      data: windows.map((w) => ({ ...w, staffId: adviser.id, timezone: TZ, active: true })),
    });
    console.log('Seeded non-LIA adviser:', adviser.name, `(${adviser.role})`, adviser.id);
  }

  const lead = await prisma.user.findUnique({ where: { email: 'yashoue@gmail.com' }, select: { id: true, role: true } });
  console.log('Availability windows each:', windows.length, '(Mon–Fri 09:00–12:00 & 13:00–17:00 NZ) → overlapping times have capacity 2');
  console.log('LEAD yashoue@gmail.com:', lead ? `present (role ${lead.role}, id ${lead.id})` : 'MISSING');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
