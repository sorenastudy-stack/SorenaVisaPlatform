/**
 * PR-TEST-ISOLATION — one Postgres schema per Jest worker.
 *
 * WHY. The suite shared a single database across 19 workers. The failures that
 * caused were not badly-written tests — teardown was already scoped to each
 * suite's own ids, and the flakiest assertion was already a correct before/after
 * delta. The problem was on the READ side: a test asserting "OWNER sees the whole
 * funnel" legitimately queries every row in the table, including fixtures another
 * worker is mid-way through creating and deleting. Two ways that bit:
 *
 *   1. The query threw outright —
 *      "Inconsistent query result: Field contact is required to return data,
 *       got null" — a required relation whose row vanished between the parent
 *      read and the relation resolution.
 *   2. Global aggregates moved under the test: expected 303, received 288,
 *      because other workers tore down commissions between the two reads.
 *
 * Neither is fixable in the test. Isolation is the only thing that makes it
 * impossible rather than less likely: a worker that cannot see another worker's
 * rows cannot be raced by them, and "sees everything" stays a meaningful
 * assertion because "everything" is now that worker's own schema.
 *
 * Cold provisioning, measured rather than assumed:
 *   19 schemas via `db push`, in parallel  7.9s
 *   19 schemas via `migrate deploy`        ~51s (and the 130-migration history
 *                                          does not replay into a fresh schema)
 *   reuse across runs via TRUNCATE         43.2s — WORSE than rebuilding, because
 *                                          TRUNCATE CASCADE over 127 tables takes
 *                                          an ACCESS EXCLUSIVE lock on each
 *
 * So the schemas are rebuilt every run. That also means they can never be stale
 * with respect to schema.prisma, which reuse would have risked.
 */
import { exec } from 'child_process';

export const SCHEMA_PREFIX = 'test_w';

/** The worker's own schema. `--runInBand` reports worker 1, so it works there too. */
export function schemaForWorker(workerId: string | undefined): string {
  return `${SCHEMA_PREFIX}${workerId ?? '1'}`;
}

/**
 * The base URL with `schema` swapped.
 *
 * Never logged: it carries credentials. Only schema NAMES are ever printed.
 */
export function urlWithSchema(baseUrl: string, schema: string): string {
  const u = new URL(baseUrl);
  u.searchParams.set('schema', schema);
  return u.toString();
}

/** `prisma db push` against one schema. It creates the schema itself. */
export function pushSchema(baseUrl: string, schema: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(
      'npx prisma db push --skip-generate --accept-data-loss',
      { env: { ...process.env, DATABASE_URL: urlWithSchema(baseUrl, schema) }, cwd: process.cwd() },
      (err) => (err ? reject(new Error(`db push failed for ${schema}: ${err.message.slice(0, 200)}`)) : resolve()),
    );
  });
}

/**
 * Replay the DDL `db push` cannot know about.
 *
 * `db push` builds from schema.prisma, so anything a migration created in raw
 * SQL is simply absent — here, seven PARTIAL unique indexes that enforce
 * "one live row per X" (commission_triggers_one_live_per_choice,
 * agent_payables_one_live_per_commission, and five siblings). Prisma has no way
 * to express a `WHERE` clause on an index, which is exactly why they were
 * written by hand.
 *
 * Their absence is not cosmetic: a test asserting "a second submission on the
 * same choice is refused" passes against production and fails against a pushed
 * schema, because the constraint doing the refusing does not exist.
 *
 * Rather than parse migration SQL (multi-line, quoted, easy to get subtly
 * wrong), ask Postgres for the canonical definition of every index the source
 * schema has and the target lacks, and rewrite the schema qualifier. Postgres
 * emits the DDL; nothing here has to understand it. Anything added later is
 * picked up with no maintenance.
 */
export async function copyMissingIndexes(
  runInSchema: (schema: string, sql: string) => Promise<unknown>,
  query: <T>(sql: string) => Promise<T[]>,
  fromSchema: string,
  toSchema: string,
): Promise<number> {
  const rows = await query<{ indexname: string; indexdef: string }>(
    `SELECT i.indexname, i.indexdef
       FROM pg_indexes i
      WHERE i.schemaname = '${fromSchema}'
        AND i.indexname NOT IN (
          SELECT indexname FROM pg_indexes WHERE schemaname = '${toSchema}'
        )
        -- Only indexes whose TABLE exists in the target. The source schema also
        -- holds Prisma's own _prisma_migrations, which db push does not create
        -- (it writes no migration history), and indexing a table that is not
        -- there fails the whole setup.
        AND i.tablename IN (
          SELECT tablename FROM pg_tables WHERE schemaname = '${toSchema}'
        )`,
  );

  // The definition is STRIPPED of its schema qualifier rather than rewritten to
  // the target's, then executed with search_path pointed at the target.
  //
  // Rewriting "ON public.t" -> "ON test_w1.t" is not enough: a partial index's
  // WHERE clause carries enum casts (`status <> 'REJECTED'::"CommissionTriggerStatus"`),
  // and those resolve through search_path, not through the table's qualifier. Left
  // alone they bind to the SOURCE schema's enum and Postgres refuses the
  // comparison — "operator does not exist: test_w1.CommissionTriggerStatus <>
  // CommissionTriggerStatus". Unqualified plus search_path makes every name in
  // the statement — table, column, type — resolve inside the target schema.
  const qualifier = new RegExp(`\\b${fromSchema}\\.`, 'g');
  for (const r of rows) {
    await runInSchema(toSchema, r.indexdef.replace(qualifier, ''));
  }
  return rows.length;
}

/**
 * Reference rows that migrations INSERT, which db push also never runs.
 *
 * Same root cause as the missing partial indexes: a migration is more than the
 * shape it produces. These tables are seeded as part of the schema's INITIAL
 * STATE — sla_configs ships nine (institutionType, stage) rows the SLA service
 * expects to exist — so a schema without them is not a faithful copy, and a test
 * that edits a config it did not create fails for the wrong reason.
 *
 * Deliberately a short explicit list rather than "every table with rows": the
 * source schema is a working dev database full of fixtures, and copying that
 * wholesale would reintroduce exactly the cross-contamination this isolation
 * exists to remove. If another migration-seeded table is added, a test fails
 * loudly the way sla.spec did, and the list grows by one line.
 */
export const MIGRATION_SEEDED_TABLES = ['sla_configs', 'platform_settings'] as const;

export async function copySeedRows(
  exec: (sql: string) => Promise<unknown>,
  query: <T>(sql: string) => Promise<T[]>,
  fromSchema: string,
  toSchema: string,
): Promise<void> {
  for (const t of MIGRATION_SEEDED_TABLES) {
    const cols = await query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name
         FROM information_schema.columns
        WHERE table_schema = '${toSchema}' AND table_name = '${t}'
        ORDER BY ordinal_position`,
    );
    if (cols.length === 0) continue;   // table not in this schema — nothing to do

    // A plain `SELECT *` fails: every schema gets its OWN copy of each enum
    // type, and Postgres treats public."ProviderType" and test_w1."ProviderType"
    // as unrelated — "column is of type test_w1.ProviderType but expression is
    // of type ProviderType". Routing enum columns through text re-resolves them
    // against the target's own type.
    const list = cols.map((c) => `"${c.column_name}"`).join(', ');
    const select = cols
      .map((c) => (c.data_type === 'USER-DEFINED'
        ? `"${c.column_name}"::text::"${toSchema}"."${enumTypeOf(c)}"`
        : `"${c.column_name}"`))
      .join(', ');

    await exec(
      `INSERT INTO "${toSchema}"."${t}" (${list}) ` +
      `SELECT ${select} FROM "${fromSchema}"."${t}" ON CONFLICT DO NOTHING`,
    );
  }
}

/** information_schema reports enums as USER-DEFINED; udt_name carries the type. */
function enumTypeOf(c: { column_name: string; data_type: string; udt_name?: string }): string {
  return c.udt_name ?? c.column_name;
}
