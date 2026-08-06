// PR-IMPORT — recompute education_programmes.verificationStatus from the source
// workbooks.
//
// WHY: the import previously mapped ANY non-empty "Verification Status" cell to
// VERIFIED (`row.verificationStatus ? 'VERIFIED' : null`). The source does not
// use tidy labels — it writes a sentence whose first words carry the confidence
// — so 379 of 1,128 rows that say "Single-source (…)" were recorded as fully
// VERIFIED. That over-states the confidence of roughly a third of the catalogue
// on exactly the field meant to flag what still needs checking before a fee is
// shown to a student.
//
// Touches ONE column. Never changes reviewStatus, isActive, fees, or anything
// else, so it cannot alter what students can see — only how confident the
// catalogue claims to be about it.
//
// Usage:
//   npx ts-node --transpile-only scripts/backfill-verification-status.ts            # dry run
//   … --commit                 # apply to rows whose value is wrong
//   … --commit --only=<ref,…>  # restrict to specific sourceRefs (e.g. the 6 new rows)
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { parseCatalogueWorkbook, parseVerificationStatus, type SourceFile } from '../src/providers/import/catalogue-workbook.logic';

const FILES: Array<[SourceFile, string]> = [
  ['ITP', 'docs/NZ_International_Polytechnic_Programmes_2026_2027.xlsx'],
  ['PTE', 'docs/NZ_International_PTE_Programmes_2026_2027.xlsx'],
  ['University', 'docs/NZ_University_Programmes_Level79_2026_2027.xlsx'],
];

(async () => {
  const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
  if (!url) { console.error('REFUSING TO RUN: no database URL.'); process.exit(1); }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const commit = process.argv.includes('--commit');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;

  if (!isLocal && commit && !process.argv.includes('--confirm-production')) {
    console.error('REFUSING TO RUN: non-local database needs --confirm-production.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // sourceRef ("PTE:row123") is the stable link back to the workbook row.
  const wanted = new Map<string, string | null>();
  for (const [sourceFile, rel] of FILES) {
    const res = parseCatalogueWorkbook(fs.readFileSync(path.join(process.cwd(), rel)), sourceFile);
    res.rows.forEach((r) => wanted.set(`${r.sourceFile}:row${r.sourceRow}`, parseVerificationStatus(r.verificationStatus)));
  }

  const rows = await prisma.educationProgramme.findMany({
    where: { sourceRef: { not: null } },
    select: { id: true, name: true, sourceRef: true, verificationStatus: true },
  });

  const changes = rows
    .filter((r) => !only || only.has(r.sourceRef!))
    .map((r) => ({ row: r, next: wanted.get(r.sourceRef!) ?? null }))
    .filter((c) => wanted.has(c.row.sourceRef!) && c.row.verificationStatus !== c.next);

  const tally: Record<string, number> = {};
  changes.forEach((c) => { const k = `${c.row.verificationStatus} → ${c.next}`; tally[k] = (tally[k] ?? 0) + 1; });

  console.log(`target: ${isLocal ? 'LOCAL' : 'PRODUCTION'}  |  mode: ${commit ? 'COMMIT' : 'DRY RUN'}${only ? `  |  restricted to ${only.size} sourceRef(s)` : ''}`);
  console.log(`\nimported programmes in scope : ${only ? changes.length + ' (filtered)' : rows.length}`);
  console.log(`rows whose status is wrong   : ${changes.length}`);
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(28)} ${v}`));

  if (!commit) { console.log('\nDry run — pass --commit to apply.'); await prisma.$disconnect(); return; }

  for (const c of changes) {
    await prisma.educationProgramme.update({ where: { id: c.row.id }, data: { verificationStatus: c.next as any } });
  }
  console.log(`\nupdated ${changes.length} rows`);

  const after = await prisma.educationProgramme.groupBy({
    by: ['verificationStatus'], _count: true, where: { sourceRef: { not: null } },
  });
  console.log('\nverificationStatus across imported programmes now:');
  after.sort((a, b) => b._count - a._count).forEach((r) => console.log(`   ${String(r.verificationStatus).padEnd(16)} ${r._count}`));
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
