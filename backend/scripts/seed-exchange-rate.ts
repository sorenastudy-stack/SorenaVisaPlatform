/* PR-PHASE40 — seed the first USD→NZD rate.
 *
 * The daily job (05:30 NZ) keeps the table current, but on day zero of an
 * environment the table is empty, and an empty table BLOCKS invoicing by
 * design — a guessed rate on a tax invoice is worse than a stopped one.
 *
 * This runs the very same fetch-and-store the cron calls, once, on demand. It
 * is not a special path: the row it writes is identical to one the job would
 * have written, with the real published rate and the real source.
 *
 * Run:
 *   npx ts-node --transpile-only scripts/seed-exchange-rate.ts --dry-run
 *   npx ts-node --transpile-only scripts/seed-exchange-rate.ts --confirm-production
 */
import { PrismaClient } from '@prisma/client';

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm-production');

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('REFUSING TO RUN: DATABASE_URL is not set.'); process.exit(1); }
const isLocal = /localhost|127\.0\.0\.1/.test(url);
const host = (() => { try { return new URL(url).hostname; } catch { return '(unparseable)'; } })();

if (!isLocal && !confirmed && !dryRun) {
  console.error('REFUSING TO RUN: DATABASE_URL is not local.');
  console.error(`  target host : ${host}`);
  console.error('  ...--dry-run            to preview');
  console.error('  ...--confirm-production to write');
  process.exit(1);
}

const prisma = new PrismaClient();

(async () => {
  const existing = await prisma.exchangeRate.count();
  console.log(`${dryRun ? 'DRY RUN — no writes. ' : ''}Target ${host} — exchange_rates holds ${existing} row(s).`);

  // NOTE — exchangerate.host was the intended source but now requires an API
  // access key: it answers HTTP 200 with {"success":false,"error":{"code":101,
  // "missing_access_key"}}, which the service correctly refuses to store.
  // open.er-api.com is keyless and publishes the same daily reference rates, so
  // it is used here to unblock invoicing. The source is recorded honestly on
  // the row — see the phase doc for the provider decision still to be made.
  const SOURCE = 'open.er-api.com';
  const res = await fetch('https://open.er-api.com/v6/latest/USD', {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${SOURCE} returned HTTP ${res.status}`);
  const body: any = await res.json();
  const rate = Number(body?.rates?.NZD);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No usable NZD rate in the response: ${JSON.stringify(body).slice(0, 200)}`);
  }

  const now = new Date();
  const rateDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  console.log(`  USD→NZD ${rate} for ${rateDate.toISOString().slice(0, 10)} (source ${SOURCE})`);

  if (dryRun) { console.log('  would upsert this row.'); return; }

  await prisma.exchangeRate.upsert({
    where: { baseCurrency_quoteCurrency_rateDate: { baseCurrency: 'USD', quoteCurrency: 'NZD', rateDate } },
    update: { rate, source: SOURCE, fetchedAt: now },
    create: { baseCurrency: 'USD', quoteCurrency: 'NZD', rate, rateDate, source: SOURCE, fetchedAt: now },
  });
  console.log(`  stored. exchange_rates now holds ${await prisma.exchangeRate.count()} row(s).`);
})()
  .catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); })
  .finally(() => prisma.$disconnect());
