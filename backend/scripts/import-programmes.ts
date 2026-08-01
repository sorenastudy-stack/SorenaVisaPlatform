/* PR-PHASE34 / PR-CATALOG-1 — CLI wrapper over the shared ProgrammeImportService.
 * Same behaviour as before (idempotent bulk import of the "Programme Database"
 * sheet → PENDING programmes tagged source=MANUAL_EXCEL). Providers are upserted by
 * the Brand column (bulk mode). The Owner-panel per-institution upload uses the
 * same service with a fixed providerId.
 *
 *   npx ts-node scripts/import-programmes.ts <path-to.xlsx> [--type=ITP|UNIVERSITY|PTE] [--dry]
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, InstitutionType } from '@prisma/client';
import { ProgrammeImportService } from '../src/providers/import/programme-import.service';

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const typeArg = (args.find((a) => a.startsWith('--type='))?.split('=')[1] ?? 'ITP').toUpperCase() as InstitutionType;
const dry = args.includes('--dry');
if (!filePath) { console.error('Usage: import-programmes.ts <file.xlsx> [--type=ITP] [--dry]'); process.exit(1); }

async function main() {
  const prisma = new PrismaClient();
  const svc = new ProgrammeImportService(prisma as never);
  const buffer = fs.readFileSync(filePath!);
  console.log(`Importing "${filePath}" (type=${typeArg}${dry ? ', DRY RUN' : ''})…`);

  const r = await svc.importFromXlsx(buffer, {
    institutionType: typeArg,
    sourceRef: `cli-${path.basename(filePath!)}`,
    dryRun: dry,
  });

  console.log(`\nProviders created: ${r.providersCreated} | Programmes created: ${r.created}, updated: ${r.updated}, skipped(no name): ${r.skipped}`);
  if (r.unmapped.length) {
    console.log(`\n⚠ ${r.unmapped.length} rows fell back to general_interdisciplinary/other — review StudyField for:`);
    r.unmapped.slice(0, 30).forEach((u) => console.log('   ' + u));
  } else {
    console.log('All rows mapped to a specific StudyField.');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); process.exit(1); });
