/**
 * PR-PHASE34 — Backfill EducationProvider.institutionType from the legacy
 * providerType enum.
 *
 * Mapping (staff-approved):
 *   POLYTECHNIC → ITP          (unambiguous)
 *   UNIVERSITY  → UNIVERSITY   (unambiguous)
 *   COLLEGE     → PTE          (AMBIGUOUS — flagged for staff review)
 *   SCHOOL      → PTE          (AMBIGUOUS — flagged for staff review)
 *
 * Rules:
 *   - Only writes where institutionType IS NULL — never overrides a value a
 *     staff member (or the importer) has already set. Safe to re-run.
 *   - COLLEGE/SCHOOL rows are backfilled to PTE *and* printed as a flagged list,
 *     because a "College" can legitimately be an ITP subsidiary or a PTE; staff
 *     confirm/correct these in the University/ITP/PTE approval UI.
 *
 * Usage:
 *   npx ts-node scripts/backfill-institution-type.ts [--dry]
 */
import { PrismaClient, ProviderType, InstitutionType } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

const UNAMBIGUOUS: Partial<Record<ProviderType, InstitutionType>> = {
  [ProviderType.POLYTECHNIC]: InstitutionType.ITP,
  [ProviderType.UNIVERSITY]: InstitutionType.UNIVERSITY,
};
const AMBIGUOUS_TO_PTE: ProviderType[] = [ProviderType.COLLEGE, ProviderType.SCHOOL];

async function main() {
  const providers = await prisma.educationProvider.findMany({
    where: { institutionType: null },
    select: { id: true, name: true, providerType: true },
  });
  console.log(`${providers.length} provider(s) with institutionType = null.` + (DRY ? ' (dry run)' : ''));

  let set = 0;
  const flagged: { name: string; providerType: ProviderType }[] = [];

  for (const p of providers) {
    let target = UNAMBIGUOUS[p.providerType];
    if (!target && AMBIGUOUS_TO_PTE.includes(p.providerType)) {
      target = InstitutionType.PTE;
      flagged.push({ name: p.name, providerType: p.providerType });
    }
    if (!target) {
      // Unknown enum value — never guess. Leave null for staff.
      flagged.push({ name: p.name, providerType: p.providerType });
      console.log(`  SKIP (no mapping) "${p.name}" [${p.providerType}] — left null for staff.`);
      continue;
    }
    if (!DRY) {
      await prisma.educationProvider.update({ where: { id: p.id }, data: { institutionType: target } });
    }
    set++;
  }

  console.log(`\nBackfilled institutionType on ${set} provider(s)${DRY ? ' (would have)' : ''}.`);
  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} provider(s) need STAFF CONFIRMATION (ambiguous or unmapped):`);
    for (const f of flagged) console.log(`   - "${f.name}" [${f.providerType}] → tentatively PTE; confirm UNIVERSITY/ITP/PTE in staff UI.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
