import { PrismaClient } from '@prisma/client';

// PR-RECS-PHASE0 — write down the intake-timing rules that are ALREADY in force.
//
// CountryExecutionConfig has no rows in production. Every reader is defensive
// (`cfg?.intakeMinLeadMonths ?? 5`), so the 5-month rule, the 12-month window and
// the 4-month LIA deadline are live today on hardcoded fallbacks. Nothing is
// broken — but the Owner-editable knobs have never actually been exercised, and
// slot rules cannot be configured at all without a row, because `slotRules`
// lives on it.
//
// THIS SEED IS A NO-OP BY CONSTRUCTION. The values below are exactly the code's
// own fallbacks, so behaviour before and after is identical. What changes is that
// the row exists, so the first person to change a knob is not also the first
// person to create the record.
//
// IDEMPOTENT: safe to run repeatedly. If the row already exists it is left
// completely alone — the script never overwrites a value someone has since
// tuned. Re-running only ever reports.
//
// Usage:
//   npx ts-node scripts/seed-country-execution-config.ts            (dev)
//   railway run --service Postgres --environment production \
//     npx ts-node scripts/seed-country-execution-config.ts
//   Add --apply to write; without it the script only reports.

const COUNTRY = 'NZ';

// These MUST match the fallbacks in the readers, or seeding would change behaviour:
//   public.service.ts        — intakeMinLeadMonths ?? 5, intakeMaxWindowMonths ?? 12
//   admission.service.ts     — liaLeadMonths ?? 4
//   schema default           — slotCount 5
const DEFAULTS = {
  intakeMinLeadMonths: 5,
  intakeMaxWindowMonths: 12,
  liaLeadMonths: 4,
  slotCount: 5,
  // Slot rules stay OFF. Production has 0 institutions typed UNIVERSITY, so a
  // mandatory-University position would reject every valid choice list. Turning
  // this on is a separate, deliberate decision once institutions are categorised.
  slotRules: { enabled: false, mandatorySlots: [] },
  // EMPTY, and that is the whole point. softScore() adds a SIXTH scoring
  // component only when a non-empty weighting is supplied:
  //     useInst = weighting != null && Object.keys(weighting).length > 0
  // Today there is no row, so no weighting, so five components. Seeding a
  // populated weighting here would silently re-rank every recommendation and
  // this would stop being a no-op. An empty object keeps scoring byte-identical
  // while still creating the row.
  institutionTypeWeighting: {},
};

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.countryExecutionConfig.findUnique({ where: { countryCode: COUNTRY } });

    if (existing) {
      console.log(`${COUNTRY}: config already exists — leaving it untouched.`);
      console.log(`   intakeMinLeadMonths=${existing.intakeMinLeadMonths} ` +
        `intakeMaxWindowMonths=${existing.intakeMaxWindowMonths} ` +
        `liaLeadMonths=${existing.liaLeadMonths} slotCount=${existing.slotCount}`);
      console.log('   (idempotent: re-running never overwrites tuned values)');
      return;
    }

    if (!apply) {
      console.log(`${COUNTRY}: no config row. Would create:`);
      console.log('  ', JSON.stringify(DEFAULTS));
      console.log('\nRe-run with --apply to write it.');
      return;
    }

    const created = await prisma.countryExecutionConfig.create({
      data: { countryCode: COUNTRY, ...DEFAULTS },
    });
    console.log(`${COUNTRY}: created.`);
    console.log(`   intakeMinLeadMonths=${created.intakeMinLeadMonths} ` +
      `intakeMaxWindowMonths=${created.intakeMaxWindowMonths} ` +
      `liaLeadMonths=${created.liaLeadMonths} slotCount=${created.slotCount}`);
    console.log('   slotRules.enabled=false — the institution-type rule stays dormant.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
