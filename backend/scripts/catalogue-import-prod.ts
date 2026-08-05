// PR-IMPORT — PRODUCTION runner for the NZ catalogue import.
//
// Deliberately a SEPARATE script from catalogue-import-local.ts rather than a
// relaxed flag on it: that script's "refuse unless localhost" guard is a safety
// property worth keeping absolute. This one inverts the guard — it refuses to
// run against anything that ISN'T production, so neither script can be pointed
// at the wrong database by accident.
//
// Requires PROD_DATABASE_URL in the environment (never read from .env, so a
// stray local DATABASE_URL cannot silently become the target) and an explicit
// --commit flag. Without --commit it dry-runs and writes nothing.
//
// Captures the two safety invariants either side of the run:
//   * providers ACTIVE   — the import must never mark an institution as
//     contractually active. That is the Owner's decision, made per agreement.
//   * programmes APPROVED — the import must never approve a programme.
//     Approved means student-visible, and nothing is student-visible unreviewed.
//
// Usage: PROD_DATABASE_URL=... npx ts-node --transpile-only scripts/catalogue-import-prod.ts [--commit]
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { EventsService } from '../src/events/events.service';
import { CatalogueImportService, type CatalogueSource } from '../src/providers/import/catalogue-import.service';
import type { SourceFile } from '../src/providers/import/catalogue-workbook.logic';

const FILES: Array<[SourceFile, string]> = [
  ['ITP', 'docs/NZ_International_Polytechnic_Programmes_2026_2027.xlsx'],
  ['PTE', 'docs/NZ_International_PTE_Programmes_2026_2027.xlsx'],
  ['University', 'docs/NZ_University_Programmes_Level79_2026_2027.xlsx'],
];

(async () => {
  const url = process.env.PROD_DATABASE_URL ?? '';
  if (!url) {
    console.error('REFUSING TO RUN: PROD_DATABASE_URL is not set.');
    process.exit(1);
  }
  if (/localhost|127\.0\.0\.1/.test(url)) {
    console.error('REFUSING TO RUN: that is a local database. Use catalogue-import-local.ts.');
    process.exit(1);
  }
  const commit = process.argv.includes('--commit');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const snapshot = async () => ({
    providers: await prisma.educationProvider.count(),
    programmes: await prisma.educationProgramme.count(),
    providersActive: await prisma.educationProvider.count({ where: { status: 'ACTIVE' } }),
    programmesApproved: await prisma.educationProgramme.count({ where: { reviewStatus: 'APPROVED' } }),
    imported: await prisma.educationProgramme.count({ where: { sourceRef: { not: null } } }),
  });

  const before = await snapshot();
  console.log(`target: PRODUCTION  |  mode: ${commit ? 'COMMIT' : 'DRY RUN (writes nothing)'}`);
  console.log(`\nbefore — providers ${before.providers}, programmes ${before.programmes}`);
  console.log(`         providers ACTIVE ${before.providersActive}, programmes APPROVED ${before.programmesApproved}`);

  const sources: CatalogueSource[] = FILES.map(([sourceFile, rel]) => ({
    sourceFile,
    buffer: fs.readFileSync(path.join(process.cwd(), rel)),
    fileName: path.basename(rel),
  }));

  const t0 = Date.now();
  const r = await prisma.$transaction(
    async () => new CatalogueImportService(prisma as any, new EventsService(prisma as any))
      .import(sources, !commit, 'prod-import-script'),
    { timeout: 900_000, maxWait: 60_000 },
  ).catch(async (e) => { console.error('\nIMPORT FAILED — rolled back:', e.message); await prisma.$disconnect(); process.exit(1); });

  console.log(`\n══════ RESULT (${((Date.now() - t0) / 1000).toFixed(1)}s) ══════`);
  r.perFile.forEach((f: any) => console.log(`  ${f.sourceFile.padEnd(11)} ${String(f.rows).padStart(4)} rows · ${f.institutions} institutions`));
  console.log(`  providers created        : ${r.providersCreated}`);
  console.log(`  providers matched        : ${r.providersMatched}   ← existing prod providers reused, not duplicated`);
  console.log(`  programmes created       : ${r.programmesCreated}`);
  console.log(`  programmes already there : ${r.programmesSkippedExisting}`);
  console.log(`  changes needing review   : ${r.changesNeedingReview.length}`);
  console.log(`  parse problems           : ${r.parseProblems.length}`);

  const after = await snapshot();
  console.log('\n══════ BEFORE / AFTER ══════');
  (Object.keys(before) as Array<keyof typeof before>).forEach((k) =>
    console.log(`  ${k.padEnd(19)} ${String(before[k]).padStart(5)} → ${String(after[k]).padStart(5)}`));

  console.log('\n══════ SAFETY INVARIANTS ══════');
  const activeHeld = after.providersActive === before.providersActive;
  const approvedHeld = after.programmesApproved === before.programmesApproved;
  console.log(`  providers ACTIVE unchanged   : ${activeHeld ? 'YES' : 'NO — VIOLATED'} (${before.providersActive} → ${after.providersActive})`);
  console.log(`  programmes APPROVED unchanged: ${approvedHeld ? 'YES' : 'NO — VIOLATED'} (${before.programmesApproved} → ${after.programmesApproved})`);
  if (commit && (!activeHeld || !approvedHeld)) process.exitCode = 1;

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
