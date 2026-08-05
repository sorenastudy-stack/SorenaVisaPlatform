// PR-IMPORT — LOCAL/DEV ONLY. Removes integration-test fixture data that has
// accumulated in the local database from repeated `jest` runs.
//
// WHY THIS EXISTS: test suites create providers named "Provider cm17859...",
// LIA users at @t.local, and their attached cases/applications, but never clean
// up. By 2026-08-05 that was 313 of the 407 local providers and 1,152 of the
// 1,154 users — swamping the 91 real imported institutions in the admin UI and
// making the "least-loaded LIA" assignment test flaky (it counts ALL LIA users,
// so leftover fixtures from a previous run skew the load balance).
//
// SAFETY RAILS
//   1. Refuses to run unless DATABASE_URL is localhost — same guard as
//      scripts/catalogue-import-local.ts. Production is never a valid target.
//   2. Fixture identification is by NAME/EMAIL SHAPE ONLY, and is asserted
//      against the import: a provider owning any programme with a sourceRef
//      (i.e. one of the 91 imported institutions) is never deletable.
//   3. --dry (the default) reports counts and deletes nothing.
//
// Deletion order is derived from the LIVE foreign-key graph rather than
// hardcoded, so it cannot drift when a migration adds a relation. RESTRICT and
// NO ACTION children are deleted depth-first; CASCADE children are left to
// Postgres.
//
// Usage: npx ts-node --transpile-only scripts/purge-test-fixtures-local.ts [--commit]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Provider names created by test fixtures, e.g. "Provider cm1785929198316_5",
 * "Uni cur1785929198316_2".
 *
 * The suffix is matched generically (a short letter prefix followed by a
 * millisecond timestamp) rather than as a fixed list of prefixes: each new spec
 * invents its own — cm, sla, uni, rc, pb, pc, hf, cur — and a fixed list
 * silently stops purging the moment someone adds another one. No real
 * institution is named "Uni ab1785929198316".
 */
const FIXTURE_PROVIDER = /^(Provider|P|Uni|Prog|Programme)\s+[a-z]{1,5}\d{10,}/;
/** Email domains used exclusively by .spec.ts fixtures. No seed script uses these. */
const FIXTURE_USER_DOMAINS = ['@t.local', '@test.local'];

type Fk = { child: string; childCol: string; parent: string; rule: string };

async function fkGraph(prisma: PrismaClient): Promise<Fk[]> {
  return prisma.$queryRawUnsafe<Fk[]>(`
    SELECT tc.table_name AS child, kcu.column_name AS "childCol",
           ccu.table_name AS parent, rc.delete_rule AS rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'`);
}

/**
 * The ids of rows in `child` that point at `ids`.
 *
 * Tables without an `id` column are skipped by the CALLER using `hasId`, not
 * caught here: inside a transaction a failed statement aborts the whole block
 * ("current transaction is aborted"), so a swallowed error would silently kill
 * every delete that follows it.
 */
async function childIdsOf(tx: any, child: string, childCol: string, ids: string[]): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.$queryRawUnsafe(
    `SELECT c.id FROM "${child}" c WHERE c."${childCol}" = ANY($1::text[])`, ids,
  );
  return rows.map((r) => r.id);
}

/** Tables that actually have an `id` column, so recursion can skip the rest. */
async function tablesWithId(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'id'`,
  );
  return new Set(rows.map((r) => r.table_name));
}

/**
 * Clear everything blocking a delete of `ids` from `table`, WITHOUT deleting
 * `table`'s own rows.
 *
 * Two child kinds matter, and missing either one fails the delete:
 *
 *   RESTRICT / NO ACTION — Postgres refuses the parent delete while these
 *     exist, so they are cleared depth-first (they have blockers of their own).
 *
 *   CASCADE — Postgres deletes these for us, but that cascade is itself blocked
 *     by ITS restricted children. Deleting a fixture provider cascades to its
 *     programmes, and a programme is RESTRICT-referenced by
 *     admission_programme_choices, so the delete fails two levels below where
 *     it was issued. These are recursed into to clear their blockers; the
 *     cascade rows themselves are left to Postgres.
 *
 * `seen` guards against FK cycles (self-references, or A->B->A).
 */
async function clearBlockers(
  tx: any, graph: Fk[], table: string, ids: string[],
  seen: Set<string>, tally: Record<string, number>, hasId: Set<string>, depth = 0,
): Promise<void> {
  if (ids.length === 0 || depth > 8 || seen.has(table)) return;
  seen.add(table);

  for (const fk of graph.filter((f) => f.parent === table)) {
    if (fk.child === table) continue; // self-reference
    if (/RESTRICT|NO ACTION/.test(fk.rule)) {
      if (hasId.has(fk.child)) {
        const kids = await childIdsOf(tx, fk.child, fk.childCol, ids);
        if (kids.length) await clearBlockers(tx, graph, fk.child, kids, seen, tally, hasId, depth + 1);
      }
      const n = await tx.$executeRawUnsafe(
        `DELETE FROM "${fk.child}" WHERE "${fk.childCol}" = ANY($1::text[])`, ids,
      );
      if (n > 0) tally[fk.child] = (tally[fk.child] ?? 0) + n;
    } else if (fk.rule === 'CASCADE' && hasId.has(fk.child)) {
      const kids = await childIdsOf(tx, fk.child, fk.childCol, ids);
      if (kids.length) await clearBlockers(tx, graph, fk.child, kids, seen, tally, hasId, depth + 1);
    }
  }
  seen.delete(table);
}

/** Clear the blockers, then delete the rows themselves. */
async function deleteBlocking(
  tx: any, graph: Fk[], table: string, col: string, ids: string[],
  seen: Set<string>, tally: Record<string, number>, hasId: Set<string>,
): Promise<void> {
  if (ids.length === 0) return;
  await clearBlockers(tx, graph, table, ids, seen, tally, hasId);
  const n = await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[])`, ids);
  if (n > 0) tally[table] = (tally[table] ?? 0) + n;
}

(async () => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local. This script is dev-only.');
    process.exit(1);
  }
  const commit = process.argv.includes('--commit');
  const prisma = new PrismaClient();

  const before = {
    providers: await prisma.educationProvider.count(),
    programmes: await prisma.educationProgramme.count(),
    users: await prisma.user.count(),
    applications: await prisma.application.count(),
    commissions: await prisma.commission.count(),
  };

  const providers = await prisma.educationProvider.findMany({
    select: { id: true, name: true, programmes: { select: { sourceRef: true } } },
  });
  const fixtureProviders = providers.filter((p) => FIXTURE_PROVIDER.test(p.name));
  const fixtureUsers = await prisma.user.findMany({
    where: { OR: FIXTURE_USER_DOMAINS.map((d) => ({ email: { endsWith: d } })) },
    select: { id: true, email: true },
  });

  // RAIL 2 — an imported institution must never be in the delete set.
  //
  // Matched on the catalogue import's OWN sourceRef format ("ITP:row12",
  // "PTE:row4", "University:row9") rather than "any non-null sourceRef": specs
  // legitimately set a sourceRef to prove the edit path cannot rewrite it, and
  // treating those as imported data made the script abort on its own debris.
  const IMPORTED = /^(ITP|PTE|University):row\d+/;
  const contaminated = fixtureProviders.filter((p) =>
    p.programmes.some((g) => g.sourceRef != null && IMPORTED.test(g.sourceRef)),
  );
  if (contaminated.length > 0) {
    console.error(`ABORT: ${contaminated.length} provider(s) match the fixture pattern but own imported programmes.`);
    contaminated.slice(0, 5).forEach((p) => console.error(`   ${p.name}`));
    process.exit(1);
  }
  if (fixtureUsers.some((u) => !FIXTURE_USER_DOMAINS.some((d) => u.email.endsWith(d)))) {
    console.error('ABORT: user selection leaked outside the fixture domains.');
    process.exit(1);
  }

  console.log(`target: LOCAL  |  mode: ${commit ? 'COMMIT' : 'DRY RUN (deletes nothing)'}`);
  console.log(`\nbefore — providers ${before.providers}, programmes ${before.programmes}, users ${before.users}`);
  console.log(`to delete — ${fixtureProviders.length} providers, ${fixtureUsers.length} users`);
  console.log(`to keep   — ${providers.length - fixtureProviders.length} providers, ${before.users - fixtureUsers.length} users`);

  if (!commit) {
    console.log('\nDry run: pass --commit to apply.');
    await prisma.$disconnect();
    return;
  }

  const graph = await fkGraph(prisma);
  const hasId = await tablesWithId(prisma);
  const tally: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    await deleteBlocking(tx, graph, 'education_providers', 'id', fixtureProviders.map((p) => p.id), new Set(), tally, hasId);
    await deleteBlocking(tx, graph, 'users', 'id', fixtureUsers.map((u) => u.id), new Set(), tally, hasId);
  }, { timeout: 600_000, maxWait: 60_000 });

  console.log('\n══════ ROWS DELETED ══════');
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t.padEnd(34)} ${n}`));

  const after = {
    providers: await prisma.educationProvider.count(),
    programmes: await prisma.educationProgramme.count(),
    users: await prisma.user.count(),
    applications: await prisma.application.count(),
    commissions: await prisma.commission.count(),
  };
  console.log('\n══════ BEFORE / AFTER ══════');
  (Object.keys(before) as Array<keyof typeof before>).forEach((k) =>
    console.log(`  ${k.padEnd(13)} ${String(before[k]).padStart(5)} → ${String(after[k]).padStart(5)}`));

  const imported = await prisma.educationProgramme.count({ where: { sourceRef: { not: null } } });
  const liaLeft = await prisma.user.count({ where: { role: 'LIA' } });
  console.log('\n══════ INVARIANTS ══════');
  console.log(`  imported programmes still present : ${imported}  ← must be 1123`);
  console.log(`  LIA users remaining               : ${liaLeft}  ← fixture LIAs gone`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
