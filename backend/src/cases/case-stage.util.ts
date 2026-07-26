import { CaseStage, Prisma } from '@prisma/client';

// PR-SLA — single source of truth for a case stage transition.
//
// Whenever a case ENTERS a new stage, stageEnteredAt must be stamped alongside it,
// because the SLA deadline calculation (SlaService.computeForCases) measures the
// stage clock from stageEnteredAt. This returns a Prisma `data` fragment to spread
// into any case.update so a stage change can never be written without its timestamp:
//
//   await tx.case.update({ where: { id }, data: setCaseStage('WITHDRAWN') });
//   await tx.case.update({ where: { id }, data: { ...setCaseStage('VISA'), inzSubmittedAt: null } });
//
// It intentionally returns a fragment rather than performing the update itself:
// some transition sites bundle the stage change with other column writes in one
// update, and a self-executing helper would split those into two writes.
export function setCaseStage(
  stage: CaseStage,
  now: Date = new Date(),
): Pick<Prisma.CaseUpdateInput, 'stage' | 'stageEnteredAt'> {
  return { stage, stageEnteredAt: now };
}
