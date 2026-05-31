/* eslint-disable no-console */
/**
 * PR-LIA-AUTO-ASSIGN, Phase 1 — one-shot backfill.
 *
 * The PR-LIA-2 auto-assignment trigger only fires on DocuSign
 * contract-sign webhook. The 3 test cases below were created before
 * any LIA existed and before any contract was signed, so they never
 * got assigned. Sheila (sheilarose@sorenavisa.com) is now the only
 * active LIA, so the load-balanced auto-pick will hand all 3 cases
 * to her — which is the intended outcome.
 *
 * Reuses LiaAssignmentService.assignLiaToCase, which is idempotent
 * (returns 'already_assigned' if a row already has an liaId), so
 * re-running this script is safe.
 *
 * Usage:
 *   cd backend && npx ts-node scripts/backfill-orphan-cases-lia.ts
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LiaAssignmentService } from '../src/cases/lia-assignment.service';

const ORPHAN_CASE_IDS = [
  'cmnoh9m3h000if947bd0sso8h',
  'cmnohad230017f9471fk0pmw9',
  'cmol29yki000eud4kbi50ug0f',
];

async function main() {
  console.log(
    `\n[backfill-orphan-cases-lia] assigning ${ORPHAN_CASE_IDS.length} cases\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const liaAssignments = app.get(LiaAssignmentService);

  let assigned = 0;
  let alreadyAssigned = 0;
  let noCandidates = 0;

  for (const caseId of ORPHAN_CASE_IDS) {
    try {
      const result = await liaAssignments.assignLiaToCase(caseId);
      switch (result.status) {
        case 'assigned':
          assigned++;
          console.log(
            `[assigned]         ${caseId} -> ${result.liaName} (${result.liaId})`,
          );
          break;
        case 'already_assigned':
          alreadyAssigned++;
          console.log(
            `[already_assigned] ${caseId} -> liaId=${result.liaId} (skipped)`,
          );
          break;
        case 'no_candidates':
          noCandidates++;
          console.warn(`[no_candidates]    ${caseId} -> left unassigned`);
          break;
      }
    } catch (err) {
      console.error(
        `[error]            ${caseId} -> ${(err as Error).message}`,
      );
    }
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`Assigned         : ${assigned}`);
  console.log(`Already assigned : ${alreadyAssigned}`);
  console.log(`No candidates    : ${noCandidates}`);
  console.log('─────────────────────────────────────────────\n');

  await app.close();
}

main().catch((err) => {
  console.error('[backfill-orphan-cases-lia] fatal:', err);
  process.exit(1);
});
