/**
 * PR-TEST-ISOLATION — drop the worker schemas after the run.
 *
 * Best-effort: a failure to clean up must never turn a green suite red, and
 * globalSetup drops stale schemas anyway, so a missed teardown is self-healing.
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { SCHEMA_PREFIX } from './db-schema';

dotenv.config();

export default async function globalTeardown(): Promise<void> {
  if (process.env.KEEP_TEST_SCHEMAS === '1') return;   // for debugging a failure
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${SCHEMA_PREFIX}%'`,
    );
    // Serially — see global-setup: concurrent CASCADE drops exhaust the lock table.
    for (const r of rows) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${r.nspname}" CASCADE`);
    }
  } catch {
    /* never fail the run over cleanup */
  } finally {
    await prisma.$disconnect();
  }
}
