import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

// PR-BOOKING-4 slice 2 — local seed: one VERIFIED LIA adviser configured
// for LIA bookings (role LIA + verified LiaProfile + bookableSessionTypes
// includes LIA + bookingActive + weekly availability). Idempotent.

const prisma = new PrismaClient();
const TZ = 'Pacific/Auckland';
const EMAIL = 'adviser.lia@booking.test';

async function main() {
  const adviser = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { role: 'LIA', isActive: true, name: 'Wiremu (LIA)', bookingActive: true, bookableSessionTypes: ['LIA'] },
    create: { email: EMAIL, name: 'Wiremu (LIA)', role: 'LIA', isActive: true, bookingActive: true, bookableSessionTypes: ['LIA'] },
    select: { id: true, name: true, role: true },
  });

  // Verified LIA credential.
  await prisma.liaProfile.upsert({
    where: { userId: adviser.id },
    update: { iaaLicenceVerifiedAt: new Date() },
    create: { userId: adviser.id, iaaLicenceNumber: 'TEST-IAA-LIA-0001', iaaLicenceVerifiedAt: new Date() },
  });

  // Weekly availability: Mon–Fri 09:00–12:00 & 13:00–17:00.
  await prisma.adviserAvailability.deleteMany({ where: { adviserId: adviser.id } });
  const wins: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = [];
  for (let d = 1; d <= 5; d++) { wins.push({ dayOfWeek: d, startMinute: 540, endMinute: 720 }, { dayOfWeek: d, startMinute: 780, endMinute: 1020 }); }
  await prisma.adviserAvailability.createMany({ data: wins.map((w) => ({ ...w, adviserId: adviser.id, timezone: TZ, active: true })) });

  console.log('Seeded VERIFIED LIA adviser:', adviser.name, `(${adviser.role})`, adviser.id);
  console.log('  bookableSessionTypes: [LIA], bookingActive: true, verified: yes, windows:', wins.length, '(Mon–Fri 09–12 & 13–17 NZ)');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
