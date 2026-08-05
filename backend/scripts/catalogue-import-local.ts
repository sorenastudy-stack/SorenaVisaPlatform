// PR-IMPORT — Phase B, LOCAL/DEV ONLY. Runs the real import service against the
// local database. Refuses to run against a non-local DATABASE_URL as a safety rail.
//
// Usage: npx ts-node --transpile-only scripts/catalogue-import-local.ts [--dry]
import 'dotenv/config';
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
  const url = process.env.DATABASE_URL ?? '';
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (!isLocal) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local. This script is dev-only;');
    console.error('a production import needs a fresh backup and explicit sign-off.');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry');

  const prisma = new PrismaClient();
  const svc = new CatalogueImportService(prisma as any, new EventsService(prisma as any));

  const sources: CatalogueSource[] = FILES.map(([sourceFile, rel]) => ({
    sourceFile,
    buffer: fs.readFileSync(path.join(process.cwd(), rel)),
    fileName: path.basename(rel),
  }));

  console.log(`target: LOCAL  |  mode: ${dryRun ? 'DRY RUN (writes nothing)' : 'COMMIT'}`);
  const before = {
    providers: await prisma.educationProvider.count(),
    programmes: await prisma.educationProgramme.count(),
  };
  console.log(`before — providers ${before.providers}, programmes ${before.programmes}`);

  const t0 = Date.now();
  const r = await svc.import(sources, dryRun, 'local-import-script');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n══════ RESULT (${secs}s) ══════`);
  r.perFile.forEach((f) => console.log(`  ${f.sourceFile.padEnd(11)} ${String(f.rows).padStart(4)} rows · ${f.institutions} institutions`));
  console.log(`  providers created        : ${r.providersCreated}`);
  console.log(`  providers matched        : ${r.providersMatched}`);
  console.log(`  programmes created       : ${r.programmesCreated}`);
  console.log(`  programmes already there : ${r.programmesSkippedExisting}`);
  console.log(`  changes needing review   : ${r.changesNeedingReview.length}`);
  console.log(`  parse problems           : ${r.parseProblems.length}`);

  const after = {
    providers: await prisma.educationProvider.count(),
    programmes: await prisma.educationProgramme.count(),
  };
  console.log(`\nafter  — providers ${after.providers} (+${after.providers - before.providers}), programmes ${after.programmes} (+${after.programmes - before.programmes})`);

  if (!dryRun) {
    const pendingProviders = await prisma.educationProvider.count({ where: { status: 'PENDING' } });
    const activeProviders = await prisma.educationProvider.count({ where: { status: 'ACTIVE' } });
    const pendingProgs = await prisma.educationProgramme.count({ where: { reviewStatus: 'PENDING' } });
    const approvedProgs = await prisma.educationProgramme.count({ where: { reviewStatus: 'APPROVED' } });
    console.log('\n══════ SAFETY INVARIANTS ══════');
    console.log(`  providers PENDING (not contracted) : ${pendingProviders}`);
    console.log(`  providers ACTIVE                   : ${activeProviders}  ← import must not have added any`);
    console.log(`  programmes PENDING                 : ${pendingProgs}`);
    console.log(`  programmes APPROVED                : ${approvedProgs}  ← import must not have approved any`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
