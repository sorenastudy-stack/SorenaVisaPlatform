/**
 * PR-TEST-ISOLATION — provision one schema per worker, before any test runs.
 *
 * Runs once. Drops anything left behind by a killed run first, so a crashed
 * suite cannot poison the next one, then pushes all schemas in parallel.
 */
import { PrismaClient } from '@prisma/client';
import type { Config } from '@jest/types';
import * as dotenv from 'dotenv';
import { SCHEMA_PREFIX, schemaForWorker, pushSchema, copyMissingIndexes, copySeedRows } from './db-schema';

dotenv.config();

export default async function globalSetup(config: Config.GlobalConfig): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set — cannot provision test schemas.');

  // One schema per worker. `--runInBand` reports maxWorkers 1.
  const workers = Math.max(1, config.maxWorkers ?? 1);
  const schemas = Array.from({ length: workers }, (_, i) => schemaForWorker(String(i + 1)));

  const prisma = new PrismaClient();
  const started = Date.now();
  try {
    // Leftovers from a previous run that was killed mid-flight. Matching on the
    // prefix rather than the current worker count, because the last run may have
    // used a different number of workers.
    const stale = await prisma.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${SCHEMA_PREFIX}%'`,
    );
    // SERIALLY. `DROP SCHEMA ... CASCADE` takes an ACCESS EXCLUSIVE lock per
    // object, and 19 populated schemas x 127 tables at once exhausts
    // max_locks_per_transaction ("out of shared memory", 53200). Provisioning
    // parallelises fine; dropping does not.
    for (const s of stale) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${s.nspname}" CASCADE`);
    }

    await Promise.all(schemas.map((s) => pushSchema(base, s)));

    // db push cannot create raw-SQL DDL (the partial unique indexes). Copy
    // whatever the migrated source schema has that the pushed one lacks.
    const source = new URL(base).searchParams.get('schema') ?? 'public';
    let copied = 0;
    for (const s of schemas) {
      copied = await copyMissingIndexes(
        // search_path must be set on the SAME connection as the CREATE INDEX,
        // so both statements go through one transaction.
        (schema, sql) => prisma.$transaction([
          prisma.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`),
          prisma.$executeRawUnsafe(sql),
        ]),
        (sql) => prisma.$queryRawUnsafe(sql) as Promise<any[]>,
        source, s,
      );
      await copySeedRows(
        (sql) => prisma.$executeRawUnsafe(sql),
        (sql) => prisma.$queryRawUnsafe(sql) as Promise<any[]>,
        source, s,
      );
    }
    // Schema NAMES only — the URL carries credentials and is never printed.
    console.log(
      `\n[test-isolation] ${schemas.length} worker schema(s) ready in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s (${SCHEMA_PREFIX}1…${workers})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
