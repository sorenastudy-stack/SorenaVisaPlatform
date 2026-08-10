/* PR-PHASE40 — the backup that runs BEFORE prisma migrate deploy.
 *
 * WHY THIS EXISTS
 * Migrations were applied to production by Railway's preDeployCommand while the
 * only backups were ones a human remembered to take beforehand, from a laptop.
 * A migration that dropped or rewrote a column on a forgotten day had nothing
 * behind it. This closes that: no migration runs on a database that was not
 * dumped seconds earlier.
 *
 * WHY IT IS NOT THE LAPTOP SCRIPT
 * preDeployCommand runs inside the Railway container, on Linux, with no D:\ and
 * no local disk worth writing to — the filesystem is thrown away when the
 * deploy finishes. So the dump goes to R2, which this project already uses for
 * documents and which outlives the container. The FORMAT is identical to the
 * manual backups (pg_dump -Fc), so a restore is the same pg_restore command
 * either way.
 *
 * FAIL CLOSED
 * Any failure — no pg_dump, no credentials, a short dump, a failed upload —
 * exits non-zero, and `&&` in the deploy command stops the migration from
 * running at all. A deploy that will not start is a bad afternoon; a migration
 * with no backup behind it is a bad year.
 *
 * It lives under src/ rather than scripts/ because scripts/ is excluded from
 * the build and never reaches the production image, which has no ts-node. The
 * deploy runs the COMPILED dist/scripts/pre-migrate-backup.js.
 *
 * Run locally against any database:
 *   npx ts-node --transpile-only src/scripts/pre-migrate-backup.ts
 */
import { spawn } from 'child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Railway injects DATABASE_URL and the R2 keys as real environment variables,
// so this is only for running the script by hand locally. Guarded because
// dotenv may not survive `npm ci --only=production`, and a missing dev
// convenience must not be what blocks a migration.
try { require('dotenv').config(); } catch { /* real env only — fine */ }

/**
 * Backups from every environment share one R2 bucket, so the key has to say
 * which database it came from — restoring demo data over production because two
 * files sat side by side with only a timestamp between them is exactly the kind
 * of mistake this whole script exists to prevent.
 *
 * RAILWAY_ENVIRONMENT_NAME is the discriminator, not NODE_ENV: NODE_ENV is
 * "production" on the demo service too, so keying off it would file demo dumps
 * under production/. Anything that is not the production environment — demo, a
 * developer laptop, a future preview environment — lands in demo/ rather than
 * inventing a directory per caller.
 */
function backupPrefix(): string {
  const env = (process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? '').toLowerCase();
  return env === 'production' ? 'db-backups/production' : 'db-backups/demo';
}
/** Below this, the dump is not a small database — it is a broken dump. */
const MIN_PLAUSIBLE_BYTES = 50_000;

function fail(message: string): never {
  console.error(`PRE-MIGRATION BACKUP FAILED — migration will NOT run.\n  ${message}`);
  process.exit(1);
}

/** pg_dump to stdout, captured in memory. This database is ~1 MB; streaming to
 *  a temp file would only add a way to half-write one. */
function pgDump(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // -Fc: the same custom format as every manual backup taken so far, so the
    // restore procedure does not fork into two.
    const proc = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: string[] = [];
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (c) => err.push(String(c)));
    proc.on('error', (e: any) => reject(
      e?.code === 'ENOENT'
        ? new Error('pg_dump is not installed in this image. See backend/Dockerfile.')
        : e,
    ));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`pg_dump exited ${code}: ${err.join('').trim()}`));
      resolve(Buffer.concat(out));
    });
  });
}

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set.');

  const accessKeyId     = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint        = process.env.R2_ENDPOINT;
  const bucket          = process.env.R2_BUCKET_NAME;
  // Checked BEFORE dumping: spending 30s on a dump that has nowhere to go, and
  // only then blocking the deploy, wastes the operator's time twice.
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    fail('R2 is not configured (need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME).');
  }

  const host = (() => { try { return new URL(url!).hostname; } catch { return '(unparseable)'; } })();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  const key = `${backupPrefix()}/${stamp}-pre-migrate.dump`;

  console.log(`[backup] dumping ${host} → r2://${bucket}/${key}`);

  let dump: Buffer;
  try {
    dump = await pgDump(url!);
  } catch (e: any) {
    fail(e?.message ?? String(e));
  }

  // A pg_dump that exits 0 having written almost nothing is the dangerous
  // failure: it looks like a backup and restores to an empty database.
  if (dump!.length < MIN_PLAUSIBLE_BYTES) {
    fail(`dump is only ${dump!.length} bytes — too small to be a real backup of this database.`);
  }
  // Custom-format dumps start with the magic "PGDMP".
  if (dump!.subarray(0, 5).toString('ascii') !== 'PGDMP') {
    fail('dump does not start with the PGDMP header — pg_dump did not produce a custom-format archive.');
  }

  try {
    const client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: dump!,
      ContentType: 'application/octet-stream',
    }));
  } catch (e: any) {
    fail(`upload to R2 failed: ${e?.message ?? e}`);
  }

  console.log(`[backup] ok — ${(dump!.length / 1024).toFixed(0)} KB stored at r2://${bucket}/${key}`);
  console.log('[backup] migration may proceed.');
})().catch((e) => fail(e?.message ?? String(e)));
