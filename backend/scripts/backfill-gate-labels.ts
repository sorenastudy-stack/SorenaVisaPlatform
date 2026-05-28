/* eslint-disable no-console */
/**
 * One-time backfill — re-render `gateResults` on every submitted
 * ScorecardSubmission row so the stored gate-label strings match the
 * current engine output (the `≥` glyph was replaced with `>=`).
 *
 * Default mode is DRY-RUN: prints what would change but writes nothing.
 * Pass `--apply` to actually update rows.
 *
 * Safety:
 *   - Skips rows where `isDraft = true` (sentinel scores, will be
 *     overwritten on real submit).
 *   - Decrypts the stored answers, re-runs the scoring engine, and
 *     ONLY rewrites the row if the recomputed `eligible` flag matches
 *     the stored `executionEligible` column. A mismatch is logged and
 *     the row is skipped — that indicates the engine logic itself
 *     drifted, not just label text, and needs human review.
 *   - Skips rows where decrypt or scoring fails.
 *   - Writes one AuditLog row per applied row with eventType
 *     `SCORECARD_GATE_LABELS_BACKFILLED` carrying the old + new
 *     labels so the change is traceable.
 *
 * Usage:
 *   npm run backfill:gate-labels             # dry-run
 *   npm run backfill:gate-labels -- --apply  # write
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { score } from '../src/scorecard/scoring/engine';
import { ScorecardService } from '../src/scorecard/scorecard.service';

interface GateRow {
  gateNumber: number;
  label: string;
  passed: boolean;
}

interface RowSummary {
  id: string;
  submittedAt: Date;
  oldLabels: string[];
  newLabels: string[];
  changedLabelCount: number;
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(
    `\n[backfill] gate-labels — mode: ${apply ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const crypto = app.get(CryptoService);

  const candidates = await prisma.scorecardSubmission.findMany({
    where: { isDraft: false },
    select: {
      id: true,
      submittedAt: true,
      executionEligible: true,
      gateResults: true,
      answersEncrypted: true,
    },
    orderBy: { submittedAt: 'asc' },
  });

  console.log(`[backfill] scanning ${candidates.length} non-draft submission(s)\n`);

  let touchable = 0;
  let unchanged = 0;
  let decryptFailed = 0;
  let eligibilityMismatch = 0;
  let applied = 0;
  const previews: RowSummary[] = [];

  for (const row of candidates) {
    // Read stored labels.
    const oldLabels = extractLabels(row.gateResults);
    if (oldLabels === null) {
      // Row has malformed gateResults (e.g. legacy {} sentinel from
      // an aborted submit). Skip — not safe to rewrite blindly.
      continue;
    }

    // Decrypt + re-score.
    let answers: Record<string, string>;
    try {
      const buf = Buffer.isBuffer(row.answersEncrypted)
        ? row.answersEncrypted
        : Buffer.from(row.answersEncrypted);
      const decrypted = crypto.decrypt(buf);
      answers = JSON.parse(decrypted) as Record<string, string>;
    } catch (err) {
      decryptFailed++;
      console.warn(
        `[skip] ${row.id}: decrypt failed — ${(err as Error).message}`,
      );
      continue;
    }

    let fresh: ReturnType<typeof score>;
    try {
      fresh = score(answers);
    } catch (err) {
      console.warn(
        `[skip] ${row.id}: score() threw — ${(err as Error).message}`,
      );
      continue;
    }

    // Safety check: eligibility must match the stored column.
    // A mismatch means engine logic drifted, not just label text.
    if (fresh.execution.eligible !== row.executionEligible) {
      eligibilityMismatch++;
      console.warn(
        `[skip] ${row.id}: executionEligible drift — stored=${row.executionEligible} engine=${fresh.execution.eligible}`,
      );
      continue;
    }

    const freshArray = ScorecardService.gatesToArray(fresh.execution.gates);
    const newLabels = freshArray.map((g) => g.label);

    // Count label deltas. Pass/fail values must also match for a
    // clean "labels-only" backfill — if they differ, skip.
    let mismatch = false;
    let changed = 0;
    if (freshArray.length !== oldLabels.length) {
      mismatch = true;
    } else {
      for (let i = 0; i < freshArray.length; i++) {
        const oldRow = parseStoredRow(row.gateResults, i);
        if (!oldRow) {
          mismatch = true;
          break;
        }
        if (oldRow.passed !== freshArray[i].passed) {
          mismatch = true;
          break;
        }
        if (oldRow.label !== freshArray[i].label) changed++;
      }
    }

    if (mismatch) {
      eligibilityMismatch++;
      console.warn(
        `[skip] ${row.id}: per-gate pass/fail drift — skipping`,
      );
      continue;
    }

    if (changed === 0) {
      unchanged++;
      continue;
    }

    touchable++;
    previews.push({
      id: row.id,
      submittedAt: row.submittedAt,
      oldLabels,
      newLabels,
      changedLabelCount: changed,
    });

    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.scorecardSubmission.update({
          where: { id: row.id },
          data: { gateResults: freshArray as unknown as Prisma.InputJsonValue },
        });
        await tx.auditLog.create({
          data: {
            userId: null,
            action: 'UPDATE',
            eventType: 'SCORECARD_GATE_LABELS_BACKFILLED',
            entityType: 'SCORECARD_SUBMISSION',
            entityId: row.id,
            oldValue: { gateLabels: oldLabels } as Prisma.InputJsonValue,
            newValue: { gateLabels: newLabels, changedLabelCount: changed } as Prisma.InputJsonValue,
            actorNameSnapshot: 'backfill-gate-labels',
            actorRoleSnapshot: 'SYSTEM',
          },
        });
      });
      applied++;
      console.log(`[apply] ${row.id}: ${changed} label(s) updated`);
    }
  }

  // Sample preview — first 3 rows that would be touched.
  if (!apply && previews.length > 0) {
    console.log(`\n[preview] sample of ${Math.min(3, previews.length)} row(s) that would change:\n`);
    for (const p of previews.slice(0, 3)) {
      console.log(`  ${p.id}  (submitted ${p.submittedAt.toISOString()})`);
      for (let i = 0; i < p.oldLabels.length; i++) {
        if (p.oldLabels[i] !== p.newLabels[i]) {
          console.log(`    -  ${p.oldLabels[i]}`);
          console.log(`    +  ${p.newLabels[i]}`);
        }
      }
      console.log('');
    }
  }

  console.log('─────────────────────────────────────────────');
  console.log(`Scanned                 : ${candidates.length}`);
  console.log(`Would change            : ${touchable}`);
  console.log(`Already up to date      : ${unchanged}`);
  console.log(`Skipped (decrypt fail)  : ${decryptFailed}`);
  console.log(`Skipped (engine drift)  : ${eligibilityMismatch}`);
  if (apply) {
    console.log(`Applied                 : ${applied}`);
  } else {
    console.log(`\n(no writes — re-run with -- --apply to commit)`);
  }
  console.log('─────────────────────────────────────────────\n');

  await app.close();
}

// Read the stored gateResults JSON column and return the labels array,
// or null if the column is malformed / empty.
function extractLabels(stored: unknown): string[] | null {
  if (!Array.isArray(stored)) {
    // Legacy object shape — convert.
    if (stored && typeof stored === 'object') {
      const labels = Object.keys(stored as Record<string, unknown>);
      return labels.length > 0 ? labels : null;
    }
    return null;
  }
  const labels: string[] = [];
  for (const row of stored) {
    if (row && typeof row === 'object' && typeof (row as GateRow).label === 'string') {
      labels.push((row as GateRow).label);
    } else {
      return null;
    }
  }
  return labels.length > 0 ? labels : null;
}

// Helper to extract row N from the stored JSON for comparison.
function parseStoredRow(stored: unknown, index: number): { label: string; passed: boolean } | null {
  if (!Array.isArray(stored)) return null;
  const row = stored[index];
  if (!row || typeof row !== 'object') return null;
  const r = row as GateRow;
  if (typeof r.label !== 'string' || typeof r.passed !== 'boolean') return null;
  return { label: r.label, passed: r.passed };
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
