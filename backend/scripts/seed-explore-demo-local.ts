// PR-EXPLORE — LOCAL/DEV ONLY. Makes enough of the imported catalogue
// student-visible for the Explore map to be worth looking at.
//
// WHY THIS IS NEEDED: Explore deliberately shows only what the Recommendation
// Engine would (APPROVED + isActive + provider ACTIVE). That is correct and
// must not be loosened — but it means a fresh local database shows an almost
// empty map, because curation happens on production. This activates a spread of
// real imported programmes locally so the layout can be reviewed with real
// names, real fees and real coordinates.
//
// Refuses to run against anything but localhost. Nothing here touches
// production, where activation is the Owner's decision on the curation screen.
//
// Usage: npx ts-node --transpile-only scripts/seed-explore-demo-local.ts [--undo]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const PER_INSTITUTION = 6;
const INSTITUTIONS = 14;

(async () => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local.');
    process.exit(1);
  }
  const undo = process.argv.includes('--undo');
  const prisma = new PrismaClient();

  if (undo) {
    const p = await prisma.educationProgramme.updateMany({
      where: { sourceRef: { not: null } },
      data: { reviewStatus: 'PENDING', isActive: false },
    });
    const v = await prisma.educationProvider.updateMany({
      where: { programmes: { some: { sourceRef: { not: null } } }, status: 'ACTIVE' },
      data: { status: 'PENDING' },
    });
    console.log(`reverted — ${p.count} programmes back to PENDING, ${v.count} institutions back to PENDING`);
    await prisma.$disconnect();
    return;
  }

  // Prefer institutions that geocoded AND have a parsed fee, so the map and the
  // price line both show something real.
  const providers = await prisma.educationProvider.findMany({
    where: {
      latitude: { not: null },
      programmes: { some: { sourceRef: { not: null }, tuitionFeeNZD: { not: null } } },
    },
    select: { id: true, name: true },
    take: INSTITUTIONS,
    orderBy: { name: 'asc' },
  });

  let activated = 0;
  for (const [i, prov] of providers.entries()) {
    await prisma.educationProvider.update({
      where: { id: prov.id },
      // A spread of featured/non-featured so the featured-first ordering and the
      // gold map pins are actually visible.
      data: { status: 'ACTIVE', isFeatured: i % 4 === 0 },
    });
    const progs = await prisma.educationProgramme.findMany({
      where: { providerId: prov.id, sourceRef: { not: null } },
      select: { id: true }, take: PER_INSTITUTION, orderBy: { name: 'asc' },
    });
    const r = await prisma.educationProgramme.updateMany({
      where: { id: { in: progs.map((g) => g.id) } },
      data: { reviewStatus: 'APPROVED', isActive: true },
    });
    activated += r.count;
  }

  const visible = await prisma.educationProgramme.count({
    where: { reviewStatus: 'APPROVED', isActive: true, provider: { status: 'ACTIVE' } },
  });
  const pinned = await prisma.educationProvider.count({
    where: { status: 'ACTIVE', latitude: { not: null } },
  });
  console.log(`activated ${activated} programmes across ${providers.length} institutions`);
  console.log(`student-visible programmes : ${visible}`);
  console.log(`institutions with a pin    : ${pinned}`);
  console.log(`\nundo with: npx ts-node --transpile-only scripts/seed-explore-demo-local.ts --undo`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
