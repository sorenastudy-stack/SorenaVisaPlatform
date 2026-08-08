/* PR-PHASE37 — backfill programme_study_fields for programmes imported before
 * the StudyField taxonomy existed.
 *
 * WHY THIS IS NEEDED. programme-import.service.ts already tags every programme
 * it creates:
 *
 *     const sf  = studyFieldKey(s(row['Subject Area']), progName);
 *     const sfId = fieldByKey[sf.key];
 *     if (sfId) await this.prisma.programmeStudyField.upsert({ ... });
 *
 * `fieldByKey` is read from the study_fields table. On production that table
 * was EMPTY when the catalogue was imported, so `sfId` was undefined every
 * time, the `if` never fired, and 1,129 programmes were created with no tags —
 * silently, because a missing tag is not an error. Seeding the taxonomy fixes
 * the ordering for future imports; this script repairs the existing rows.
 *
 * The mapping is NOT reimplemented here. `studyFieldKey()` is imported from
 * programme-import.logic.ts, so the backfill and the importer cannot drift —
 * a programme re-imported later lands on the same field it gets here.
 *
 * Run:
 *   npx ts-node --transpile-only scripts/backfill-programme-study-fields.ts --dry-run
 *   npx ts-node --transpile-only scripts/backfill-programme-study-fields.ts --confirm-production
 */
import { PrismaClient } from '@prisma/client';
import { studyFieldKey } from '../src/providers/import/programme-import.logic';

// Fields with backgroundWeight 0. A programme landing here IS correctly tagged
// and IS matchable — it simply maps to q16 'Other', so it contributes nothing
// to the field-of-study score. Added in PR-PHASE34 for ITP subject areas that
// had no scored q16 option. Expected, not a defect; surfaced in the report so
// the size of the bucket is visible rather than assumed.
const ZERO_WEIGHT_KEYS = new Set([
  'other', 'personal_services', 'sport_recreation', 'social_community', 'foundation_pathways',
]);

// ── PRODUCTION GUARD ────────────────────────────────────────────────────────
// Same rail as seed-study-fields.ts, geocode-providers.ts and
// backfill-verification-status.ts. "Local" is deliberately narrow — anything
// that is not localhost/127.0.0.1 is treated as production, so a demo or
// staging URL is gated too.
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm-production');

function guard(): PrismaClient {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    console.error('REFUSING TO RUN: DATABASE_URL is not set.');
    process.exit(1);
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const host = (() => { try { return new URL(url).hostname; } catch { return '(unparseable host)'; } })();

  if (!isLocal && !confirmed && !dryRun) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local.');
    console.error(`  target host : ${host}`);
    console.error('');
    console.error('This writes programme_study_fields. Against production that is a real data');
    console.error('change, so it needs to be deliberate:');
    console.error('');
    console.error('  npx ts-node --transpile-only scripts/backfill-programme-study-fields.ts --dry-run');
    console.error('  npx ts-node --transpile-only scripts/backfill-programme-study-fields.ts --confirm-production');
    console.error('');
    console.error('Take a backup first, per the standing rule.');
    process.exit(1);
  }
  if (!isLocal && !dryRun) {
    console.log(`⚠ RUNNING AGAINST A NON-LOCAL DATABASE — host ${host}`);
    console.log('  writing: programme_study_fields ONLY');
    console.log('  method : upsert by (programmeId, studyFieldId) — no deletes, no truncates\n');
  }
  if (isLocal && confirmed) {
    console.log('note: --confirm-production given but DATABASE_URL is local; running locally.\n');
  }
  if (dryRun) console.log(`DRY RUN — no writes. Target host: ${host}\n`);

  return new PrismaClient();
}

const prisma = guard();

interface Plan {
  programmeId: string;
  name:        string;
  raw:         string;
  key:         string;
  /** studyFieldKey() could not place this confidently and fell back. */
  unmapped:    boolean;
  /** No study_fields row for `key` — nothing can be written. */
  missingField: boolean;
  alreadyTagged: boolean;
}

async function plan(): Promise<{ plans: Plan[]; fieldByKey: Record<string, string> }> {
  const fields = await prisma.studyField.findMany({ select: { id: true, key: true } });
  const fieldByKey = Object.fromEntries(fields.map((f) => [f.key, f.id]));

  const programmes = await prisma.educationProgramme.findMany({
    select: { id: true, name: true, subjectAreaRaw: true },
  });

  // One query rather than one per programme: which pairs already exist.
  const existing = await prisma.programmeStudyField.findMany({
    select: { programmeId: true, studyFieldId: true },
  });
  const have = new Set(existing.map((e) => `${e.programmeId}|${e.studyFieldId}`));

  const plans = programmes.map((p) => {
    // Same call as the importer, same argument order.
    const sf = studyFieldKey(p.subjectAreaRaw ?? null, p.name);
    const sfId = fieldByKey[sf.key];
    return {
      programmeId: p.id,
      name: p.name,
      raw: p.subjectAreaRaw ?? '',
      key: sf.key,
      unmapped: sf.unmapped,
      missingField: !sfId,
      alreadyTagged: sfId ? have.has(`${p.id}|${sfId}`) : false,
    };
  });

  return { plans, fieldByKey };
}

function report(plans: Plan[]): void {
  const total = plans.length;
  const missing = plans.filter((p) => p.missingField);
  const writable = plans.filter((p) => !p.missingField);
  const toCreate = writable.filter((p) => !p.alreadyTagged);
  const already = writable.filter((p) => p.alreadyTagged);
  const unmapped = writable.filter((p) => p.unmapped);
  const zeroWeight = writable.filter((p) => ZERO_WEIGHT_KEYS.has(p.key));

  console.log(`PROGRAMMES: ${total}\n`);
  console.log(`  would be tagged (CREATE) .......... ${toCreate.length}`);
  console.log(`  already tagged (no-op) ............ ${already.length}`);
  console.log(`  cannot tag — no study_fields row .. ${missing.length}`);
  console.log(`  MATCH RATE ........................ ${((writable.length / total) * 100).toFixed(1)}%\n`);

  const byKey = new Map<string, number>();
  for (const p of writable) byKey.set(p.key, (byKey.get(p.key) ?? 0) + 1);
  console.log('DISTRIBUTION BY STUDY FIELD');
  for (const [key, n] of [...byKey].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ZERO_WEIGHT_KEYS.has(key) ? 'w=0 ' : '    '}${key.padEnd(28)} ${n}`);
  }

  // A confident mapping and a fallback are very different things, and the
  // fallback keys are also legitimate answers — so they are counted separately
  // rather than inferred from the key alone.
  console.log(`\nZERO-WEIGHT BUCKETS — tagged and matchable, but score 0 for field of study`);
  console.log(`  programmes in these buckets ....... ${zeroWeight.length} of ${writable.length}`);
  for (const k of ZERO_WEIGHT_KEYS) {
    const n = writable.filter((p) => p.key === k).length;
    if (n) console.log(`    ${k.padEnd(26)} ${n}`);
  }

  console.log(`\nFELL BACK (studyFieldKey could not place these confidently): ${unmapped.length}`);
  if (unmapped.length) {
    const rawCounts = new Map<string, number>();
    for (const p of unmapped) {
      const label = p.raw || '(empty subjectAreaRaw)';
      rawCounts.set(label, (rawCounts.get(label) ?? 0) + 1);
    }
    console.log('  distinct subjectAreaRaw values, most common first —');
    console.log('  these are the candidates for a mapping fix before running for real:');
    for (const [raw, n] of [...rawCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${raw}`);
    }
  }

  if (missing.length) {
    const keys = [...new Set(missing.map((p) => p.key))];
    console.log(`\n⚠ NO study_fields ROW for: ${keys.join(', ')}`);
    console.log('  These programmes would be skipped. Seed the taxonomy first.');
  }

  console.log('\nWrites are upsert on (programmeId, studyFieldId), isPrimary=true.');
  console.log('No deleteMany, no truncate. programme_study_fields is the only table touched.');
}

async function apply(plans: Plan[], fieldByKey: Record<string, string>): Promise<void> {
  let created = 0;
  let skipped = 0;
  for (const p of plans) {
    const sfId = fieldByKey[p.key];
    if (!sfId) { skipped++; continue; }
    await prisma.programmeStudyField.upsert({
      where: { programmeId_studyFieldId: { programmeId: p.programmeId, studyFieldId: sfId } },
      update: { isPrimary: true },
      create: { programmeId: p.programmeId, studyFieldId: sfId, isPrimary: true },
    });
    created++;
  }
  const rows = await prisma.programmeStudyField.count();
  console.log(`Tagged ${created} programmes (${skipped} skipped — no study field).`);
  console.log(`programme_study_fields now holds ${rows} rows.`);
}

(async () => {
  const { plans, fieldByKey } = await plan();
  if (dryRun) report(plans);
  else await apply(plans, fieldByKey);
})()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
