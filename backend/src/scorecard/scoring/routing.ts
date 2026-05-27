// PR-SCORECARD-1 — Routing logic (NEW — not in the Python engine).
//
// Maps band + hard-stop state to the structured ScorecardNextAction
// enum and the English copy that goes back to the user. The
// engine's legacy `nextAction` string is preserved for the report
// renderer; this module produces the data the modern API consumes.
//
// Fix 9 (PR-SCORECARD-2 follow-up): Persian was removed from the
// SCORECARD FLOW. `nextActionTextFa` is kept in the response shape
// for API compatibility (consumers may still read it) but is now
// populated with the same English string as `nextActionTextEn`. If
// the scorecard market expands to bilingual users again, restore the
// Persian copy here — no schema change is needed (the column already
// exists in the database).
//
// Rules per the original PR spec:
//   * Any hard stop active → BLOCKED_HARD_STOP, message names the
//     first hard stop + its resolution
//   * Band 1 or 2 → NURTURE_ONLY (no consultation, no booking)
//   * Band 3 → PAY_GAP_CLOSING_SESSION (30 NZD payment then booking)
//   * Bands 4, 5, 6 → BOOK_FREE_15MIN_SESSION (mandatory even at 100)

import type { BandEnum } from './bands';
import type { HardStop } from './hard-stops';

export type ScorecardNextActionValue =
  | 'NURTURE_ONLY'
  | 'PAY_GAP_CLOSING_SESSION'
  | 'BOOK_FREE_15MIN_SESSION'
  | 'BLOCKED_HARD_STOP';

export interface RoutingDecision {
  nextAction: ScorecardNextActionValue;
  nextActionTextEn: string;
  nextActionTextFa: string;
}

// Helper: build a RoutingDecision where Fa mirrors En (Fix 9 default).
function decision(
  nextAction: ScorecardNextActionValue,
  textEn: string,
): RoutingDecision {
  return { nextAction, nextActionTextEn: textEn, nextActionTextFa: textEn };
}

export function determineRouting(
  band: BandEnum,
  hardStops: HardStop[],
  _executionEligible: boolean,
): RoutingDecision {
  // Hard stop ALWAYS overrides — even Band 6 with one active hard
  // stop gets BLOCKED_HARD_STOP. The Python engine routes blocked
  // candidates through `Resolve <HS>`; we surface a friendly
  // message instead and keep the structured code on the row.
  if (hardStops.length > 0) {
    const first = hardStops[0];
    return decision(
      'BLOCKED_HARD_STOP',
      `Before we can proceed, we need to resolve: ${first.name}. ${first.resolution}`,
    );
  }

  if (band === 'BAND_1' || band === 'BAND_2') {
    return decision(
      'NURTURE_ONLY',
      'We have free educational resources tailored to your profile. We will email you a personalised learning plan.',
    );
  }

  if (band === 'BAND_3') {
    return decision(
      'PAY_GAP_CLOSING_SESSION',
      'Your next step is a 30 NZD Gap-Closing Roadmap Session. On payment, an AI-generated improvement plan and a booking link with a language-matched Admission Specialist will be sent to you.',
    );
  }

  // Bands 4, 5, 6 — mandatory free 15-min session
  return decision(
    'BOOK_FREE_15MIN_SESSION',
    'You qualify for a free 15-minute consultation with our team. After this mandatory session, you may proceed with the 200 NZD account opening.',
  );
}
