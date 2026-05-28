// PR-SCORECARD-1 — verbatim port of check_execution_gates().
//
// Source: Sorena_Scoring_Reference/sorena_scoring.py lines 505-521.
// Five gates, all-must-pass for executionEligible=true. The Python
// uses object keys with the "Gate N:" prefix as labels — we preserve
// the exact strings because the SAMPLE PDF renders them verbatim
// and the staff view echoes them.

import type { HardStop } from './hard-stops';

export interface GateCheck {
  gates: Record<string, boolean>;
  eligible: boolean;
}

export function checkExecutionGates(
  total: number,
  catScores: Record<number, number>,
  hardStops: HardStop[],
  answers: Record<string, string>,
): GateCheck {
  const gates: Record<string, boolean> = {};
  gates['Gate 1: Total Score >= 70'] = total >= 70;
  gates['Gate 2: Academic & Career >= 12'] = (catScores[2] ?? 0) >= 12;
  gates['Gate 3: Financial & Operational >= 12'] = (catScores[3] ?? 0) >= 12;
  gates['Gate 4: No Active Hard Stop'] = hardStops.length === 0;

  const liaClear = !hardStops.some((h) => h.code === 'HS4');
  const refused = answers.q44_refusal === 'Yes';
  gates['Gate 5: No Legal/Visa Complexity'] =
    liaClear && !(refused && answers.q46_refusal_recency === 'Less than 6 months ago');

  const eligible = Object.values(gates).every((v) => v === true);
  return { gates, eligible };
}
