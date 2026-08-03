// PR-ADMISSION-FOLLOWUP (step 5) — pure logic for the 5-working-day institution follow-up. NO I/O.
// Two things frozen before wiring: the "Day 5" computation (working days, NZ holidays — via the
// canonical util so it never drifts from PR-SLA) and the idempotent sweep PLAN (which records need a
// follow-up task created, and which open tasks should be resolved). The service does the DB work.

import { addWorkingDays } from '../../../common/working-days/nz-working-days';
import type { SubmissionOutcome } from '../submission/submission.logic';

// A soft nudge, not a contractual deadline: chase the institution if a submission is still PENDING
// this many WORKING days after it was submitted.
export const FOLLOW_UP_WORKING_DAYS = 5;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const asDate = (yyyymmdd: string): Date => new Date(`${yyyymmdd}T00:00:00Z`);

// The date a submission's follow-up falls due: submittedAt + 5 working days (skipping weekends + NZ
// public holidays).
export function followUpDueDate(submittedAt: string): string {
  return ymd(addWorkingDays(asDate(submittedAt), FOLLOW_UP_WORKING_DAYS));
}

// Is the follow-up due as of `now`? True once the current date has reached the due date.
export function isFollowUpDue(submittedAt: string, now: Date): boolean {
  return ymd(now) >= followUpDueDate(submittedAt);
}

export function followUpTitle(programme: string, provider: string | null, submittedAt: string): string {
  const at = provider ? ` at ${provider}` : '';
  return `Follow up: ${programme}${at} — submitted ${submittedAt}, no response after ${FOLLOW_UP_WORKING_DAYS} working days`;
}

// ── sweep plan ────────────────────────────────────────────────────────────────

// Per-choice state the sweep reasons over: the LATEST attempt (a choice's live status) + which of
// its records currently have an OPEN follow-up task.
export interface ChoiceSweepState {
  choiceId: string;
  latest: { recordId: string; submittedAt: string; outcome: SubmissionOutcome } | null;
  openTaskRecordIds: string[];
}

export interface FollowUpPlan {
  toCreate: Array<{ choiceId: string; recordId: string }>;
  toResolve: string[]; // record ids whose OPEN task should be closed
}

// Decide the sweep actions. A follow-up is created for the latest attempt when it is still PENDING,
// past due, and has no open task. An open task is resolved whenever it is NOT for the current
// latest-still-PENDING record — covering: the response arrived (latest ≠ PENDING), the attempt was
// superseded by a newer submission, or the record was deleted (it won't appear as `latest`).
// Deterministic and non-mutating so the golden battery pins every branch.
export function planFollowUpSweep(choices: ChoiceSweepState[], now: Date): FollowUpPlan {
  const toCreate: FollowUpPlan['toCreate'] = [];
  const toResolve: string[] = [];

  for (const ch of choices) {
    const activePendingId = ch.latest && ch.latest.outcome === 'PENDING' ? ch.latest.recordId : null;

    if (
      activePendingId &&
      isFollowUpDue(ch.latest!.submittedAt, now) &&
      !ch.openTaskRecordIds.includes(activePendingId)
    ) {
      toCreate.push({ choiceId: ch.choiceId, recordId: activePendingId });
    }

    for (const openId of ch.openTaskRecordIds) {
      if (openId !== activePendingId) toResolve.push(openId);
    }
  }

  return { toCreate, toResolve };
}
