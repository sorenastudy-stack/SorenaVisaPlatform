import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

// PR-BOOKING-3 — local seed: one NON-LIA adviser (CONSULTANT) with weekly
// availability so FREE_15 slots appear, plus a sanity check that the LEAD
// yashoue@gmail.com exists. Idempotent.

const prisma = new PrismaClient();
const TZ = 'Pacific/Auckland';
const ADVISER_EMAIL = 'adviser.free@booking.test';

async function main() {
  const adviser = await prisma.user.upsert({
    where: { email: ADVISER_EMAIL },
    update: { role: 'CONSULTANT', isActive: true, name: 'Aroha (Consultant)' },
    create: { email: ADVISER_EMAIL, name: 'Aroha (Consultant)', role: 'CONSULTANT', isActive: true },
    select: { id: true, name: true, role: true },
  });

  // Mon–Fri 09:00–12:00 and 13:00–17:00 (minutes-from-midnight, NZ tz).
  await prisma.adviserAvailability.deleteMany({ where: { adviserId: adviser.id } });
  const windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = [];
  for (let dow = 1; dow <= 5; dow++) {
    windows.push({ dayOfWeek: dow, startMinute: 540, endMinute: 720 });
    windows.push({ dayOfWeek: dow, startMinute: 780, endMinute: 1020 });
  }
  await prisma.adviserAvailability.createMany({
    data: windows.map((w) => ({ ...w, adviserId: adviser.id, timezone: TZ, active: true })),
  });

  const lead = await prisma.user.findUnique({ where: { email: 'yashoue@gmail.com' }, select: { id: true, role: true } });

  console.log('Seeded non-LIA adviser:', adviser.name, `(${adviser.role})`, adviser.id);
  console.log('Availability windows:', windows.length, '(Mon–Fri 09:00–12:00 & 13:00–17:00 NZ)');
  console.log('LEAD yashoue@gmail.com:', lead ? `present (role ${lead.role}, id ${lead.id})` : 'MISSING');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
