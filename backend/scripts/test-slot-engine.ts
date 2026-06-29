import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { BookingService } from '../src/booking/booking.service';
import { PrismaService } from '../src/prisma/prisma.service';

// PR-BOOKING-1 — local-only slot-engine test/seed. Seeds one verified LIA
// adviser with weekly availability + a test lead, then exercises the slot
// engine and the booking-commit guard, printing results. Cleans up the
// bookings it creates. Run: npx ts-node scripts/test-slot-engine.ts

const prisma = new PrismaClient();
const booking = new BookingService(prisma as unknown as PrismaService);

const TZ = 'Pacific/Auckland';
const ADVISER_EMAIL = 'adviser.lia@booking.test';

function fmt(d: Date): string {
  const nz = d.toLocaleString('en-NZ', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${nz} NZ  (${d.toISOString()} UTC)`;
}

async function main() {
  // ── Seed adviser (User role LIA + verified LiaProfile) ──────────────
  const adviser = await prisma.user.upsert({
    where: { email: ADVISER_EMAIL },
    update: { role: 'LIA', isActive: true, name: 'Test LIA Adviser' },
    create: { email: ADVISER_EMAIL, name: 'Test LIA Adviser', role: 'LIA', isActive: true },
    select: { id: true },
  });
  await prisma.liaProfile.upsert({
    where: { userId: adviser.id },
    update: { iaaLicenceVerifiedAt: new Date() },
    create: { userId: adviser.id, iaaLicenceNumber: 'TEST-IAA-0001', iaaLicenceVerifiedAt: new Date() },
  });

  // ── Reset weekly availability: Mon–Fri 09:00–12:00 and 13:00–17:00 ──
  await prisma.adviserAvailability.deleteMany({ where: { adviserId: adviser.id } });
  const windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = [];
  for (let dow = 1; dow <= 5; dow++) {
    windows.push({ dayOfWeek: dow, startMinute: 540, endMinute: 720 });  // 09:00–12:00
    windows.push({ dayOfWeek: dow, startMinute: 780, endMinute: 1020 }); // 13:00–17:00
  }
  await prisma.adviserAvailability.createMany({
    data: windows.map((w) => ({ ...w, adviserId: adviser.id, timezone: TZ, active: true })),
  });

  // ── Seed a test lead (Contact → Lead) to attach bookings to ─────────
  const contact = await prisma.contact.create({ data: { fullName: 'Slot Test Lead' } });
  const lead = await prisma.lead.create({ data: { contactId: contact.id } });
  const createdConsultationIds: string[] = [];

  const now = new Date();
  const dateFrom = now;
  const dateTo = new Date(now.getTime() + 7 * 86_400_000);

  console.log('======================================================');
  console.log('SLOT ENGINE TEST — adviser:', adviser.id);
  console.log('availability: Mon–Fri 09:00–12:00 & 13:00–17:00', TZ);
  console.log('now:', fmt(now));
  console.log('session type: LIA (45 min), 24h lead time, range = next 7 days');
  console.log('======================================================\n');

  // ── 1. Slot engine (DB-backed, via the real service) ────────────────
  const res = await booking.getAvailableSlots({
    adviserId: adviser.id, sessionType: 'LIA', dateFrom, dateTo, now,
  });
  console.log(`timezone=${res.timezone} duration=${res.durationMinutes}min  total slots=${res.slots.length}\n`);
  console.log('First 12 slots:');
  res.slots.slice(0, 12).forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(s.start)}  ->  ${fmt(s.end)}`));

  // ── Assertions ──────────────────────────────────────────────────────
  const leadCutoff = new Date(now.getTime() + 24 * 60 * 60_000);
  const anyPast = res.slots.some((s) => s.start.getTime() < now.getTime());
  const anyInsideLead = res.slots.some((s) => s.start.getTime() < leadCutoff.getTime());
  const earliest = res.slots[0]?.start;
  console.log('\nASSERTIONS:');
  console.log('  no slot in the past:        ', !anyPast ? 'PASS' : 'FAIL');
  console.log('  no slot within 24h lead:    ', !anyInsideLead ? 'PASS' : 'FAIL');
  console.log('  earliest slot >= now + 24h: ', earliest && earliest.getTime() >= leadCutoff.getTime() ? 'PASS' : 'FAIL',
    earliest ? `(earliest = ${fmt(earliest)})` : '');

  // ── 2. Busy exclusion (DB-backed): book the first slot, re-query ────
  const target = res.slots[0];
  const c1 = await prisma.consultation.create({
    data: {
      leadId: lead.id, type: 'LIA', amountNZD: 150, assignedToId: adviser.id,
      status: 'BOOKED', scheduledAt: target.start, scheduledEndAt: target.end, durationMinutes: 45,
    },
    select: { id: true },
  });
  createdConsultationIds.push(c1.id);
  const res2 = await booking.getAvailableSlots({ adviserId: adviser.id, sessionType: 'LIA', dateFrom, dateTo, now });
  const stillOffered = res2.slots.some((s) => s.start.getTime() === target.start.getTime());
  console.log('\nBUSY EXCLUSION:');
  console.log('  booked first slot:          ', fmt(target.start));
  console.log('  slot removed after booking: ', !stillOffered ? 'PASS' : 'FAIL',
    `(count ${res.slots.length} -> ${res2.slots.length})`);

  // ── 3. Commit guard / double-booking 409 ────────────────────────────
  const freeSlot = res2.slots[0];
  const pendingA = await prisma.consultation.create({
    data: { leadId: lead.id, type: 'LIA', amountNZD: 150, status: 'PENDING' }, select: { id: true },
  });
  const pendingB = await prisma.consultation.create({
    data: { leadId: lead.id, type: 'LIA', amountNZD: 150, status: 'PENDING' }, select: { id: true },
  });
  createdConsultationIds.push(pendingA.id, pendingB.id);

  const committed = await booking.commitBooking({
    consultationId: pendingA.id, adviserId: adviser.id, sessionType: 'LIA',
    slotStart: freeSlot.start, timezone: TZ, confirm: true,
  });
  console.log('\nCOMMIT GUARD:');
  console.log('  committed booking A:        ', fmt(committed.scheduledAt), '->', committed.status);

  let got409 = false;
  try {
    await booking.commitBooking({
      consultationId: pendingB.id, adviserId: adviser.id, sessionType: 'LIA',
      slotStart: freeSlot.start, timezone: TZ, confirm: true,
    });
  } catch (e: any) {
    got409 = e?.status === 409 || /just taken/i.test(e?.message ?? '');
    console.log('  double-book B rejected:     ', got409 ? 'PASS (409)' : `FAIL (${e?.message})`);
  }
  if (!got409) console.log('  double-book B rejected:      FAIL (no error thrown)');

  // ── Cleanup the bookings/lead this script created ───────────────────
  await prisma.consultation.deleteMany({ where: { id: { in: createdConsultationIds } } });
  await prisma.lead.delete({ where: { id: lead.id } });
  await prisma.contact.delete({ where: { id: contact.id } });
  console.log('\ncleanup: removed test consultations + lead/contact (adviser + availability kept).');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('TEST ERROR:', e);
  await prisma.$disconnect();
  process.exit(1);
});
