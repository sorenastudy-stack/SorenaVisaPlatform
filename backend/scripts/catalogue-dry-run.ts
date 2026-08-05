// PR-IMPORT — Phase A dry run. Reads all three source workbooks, resolves what the
// import WOULD do against the current database, and reports. Writes nothing.
//
// Usage: npx ts-node --transpile-only scripts/catalogue-dry-run.ts
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  parseCatalogueWorkbook,
  providerTypeFor,
  subjectAreasFor,
  UNSPECIFIED_SUBJECT_AREA,
  type SourceFile,
  type ParsedProgrammeRow,
} from '../src/providers/import/catalogue-workbook.logic';

const FILES: Array<[SourceFile, string]> = [
  ['ITP', 'docs/NZ_International_Polytechnic_Programmes_2026_2027.xlsx'],
  ['PTE', 'docs/NZ_International_PTE_Programmes_2026_2027.xlsx'],
  ['University', 'docs/NZ_University_Programmes_Level79_2026_2027.xlsx'],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  const prisma = new PrismaClient();
  const all: ParsedProgrammeRow[] = [];
  const problems: string[] = [];

  console.log('══════ PARSE ══════');
  for (const [src, rel] of FILES) {
    const buf = fs.readFileSync(path.join(process.cwd(), rel));
    const res = parseCatalogueWorkbook(buf, src);
    all.push(...res.rows);
    res.problems.forEach((p) => problems.push(`${src} row ${p.sourceRow}: ${p.issue} (${p.raw})`));
    console.log(`  ${src.padEnd(11)} ${String(res.rows.length).padStart(4)} programmes · ${String(res.institutions.length).padStart(2)} institutions · ${res.problems.length} problems`);
  }
  console.log(`  ${'TOTAL'.padEnd(11)} ${String(all.length).padStart(4)} programmes · ${new Set(all.map(r => r.institutionName)).size} institutions`);

  // ── institutions: create vs match ──
  const existing = await prisma.educationProvider.findMany({ select: { id: true, name: true, status: true } });
  const byNorm = new Map(existing.map((p) => [norm(p.name), p]));
  const names = [...new Set(all.map((r) => r.institutionName))];
  const toCreate: string[] = [];
  const toMatch: Array<{ src: string; existing: string; status: string }> = [];
  for (const n of names) {
    const hit = byNorm.get(norm(n));
    hit ? toMatch.push({ src: n, existing: hit.name, status: hit.status }) : toCreate.push(n);
  }

  console.log('\n══════ INSTITUTIONS ══════');
  console.log(`  already in DB (would MATCH, left untouched): ${toMatch.length}`);
  toMatch.slice(0, 10).forEach((m) => console.log(`     "${m.src}"  →  existing "${m.existing}" [${m.status}]`));
  if (toMatch.length > 10) console.log(`     … and ${toMatch.length - 10} more`);
  console.log(`  would CREATE as PENDING (no agreement yet): ${toCreate.length}`);
  const byType: Record<string, number> = {};
  for (const n of toCreate) {
    const src = all.find((r) => r.institutionName === n)!.sourceFile;
    const t = providerTypeFor(src);
    byType[t] = (byType[t] ?? 0) + 1;
  }
  Object.entries(byType).forEach(([t, c]) => console.log(`     ${t.padEnd(12)} ${c}`));

  // ── programmes ──
  const existingProgrammes = await prisma.educationProgramme.count();
  console.log('\n══════ PROGRAMMES ══════');
  console.log(`  already in DB: ${existingProgrammes}`);
  console.log(`  would CREATE as reviewStatus=PENDING: ${all.length}`);
  const byLevel: Record<string, number> = {};
  all.forEach((r) => { const k = r.nzqfLevel == null ? 'unparsed' : `Level ${r.nzqfLevel}`; byLevel[k] = (byLevel[k] ?? 0) + 1; });
  console.log('  by NZQF level: ' + Object.entries(byLevel).sort().map(([k, v]) => `${k}=${v}`).join('  '));

  // ── subject areas (the tabs) ──
  console.log('\n══════ SUBJECT-AREA TABS ══════');
  const tabCounts = names.map((n) => ({ n, tabs: subjectAreasFor(all, n).length })).sort((a, b) => b.tabs - a.tabs);
  console.log(`  distinct labels overall: ${new Set(all.map(r => r.subjectAreaRaw)).size} (NOT a shared taxonomy — per-institution)`);
  console.log(`  tabs per institution — max ${tabCounts[0].tabs}, median ${tabCounts[Math.floor(tabCounts.length / 2)].tabs}, min ${tabCounts[tabCounts.length - 1].tabs}`);
  const unspecified = all.filter((r) => r.subjectAreaRaw === UNSPECIFIED_SUBJECT_AREA);
  console.log(`  rows landing under "${UNSPECIFIED_SUBJECT_AREA}": ${unspecified.length}`);
  [...new Set(unspecified.map((r) => r.institutionName))].forEach((i) =>
    console.log(`     ${unspecified.filter((r) => r.institutionName === i).length} × ${i}`));
  console.log('  example — first institution\'s tabs:');
  subjectAreasFor(all, tabCounts[0].n).forEach((t) => console.log(`     ${String(t.count).padStart(3)}  ${t.label}`));

  // ── fees ──
  console.log('\n══════ TUITION FEES ══════');
  const parsed = all.filter((r) => r.tuitionFeeNZD != null);
  const unparsed = all.filter((r) => r.tuitionFeeNZD == null);
  console.log(`  parsed to a single figure : ${parsed.length}`);
  console.log(`  kept as raw text only     : ${unparsed.length}`);
  const byNote: Record<string, number> = {};
  unparsed.forEach((r) => { const k = r.tuitionParseNote ?? 'unknown'; byNote[k] = (byNote[k] ?? 0) + 1; });
  Object.entries(byNote).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${String(v).padStart(4)}  ${k}`));
  console.log('  samples of unparseable fees (raw text preserved):');
  unparsed.filter((r) => r.tuitionFeeRaw).slice(0, 5).forEach((r) =>
    console.log(`     [${r.sourceFile} r${r.sourceRow}] ${(r.tuitionFeeRaw ?? '').slice(0, 96)}`));

  if (problems.length) {
    console.log('\n══════ PROBLEMS ══════');
    problems.slice(0, 20).forEach((p) => console.log('  ' + p));
  } else {
    console.log('\n══════ PROBLEMS ══════\n  none');
  }

  console.log('\nDRY RUN — nothing was written.');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
