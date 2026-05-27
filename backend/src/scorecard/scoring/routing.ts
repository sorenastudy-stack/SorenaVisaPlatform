// PR-SCORECARD-1 — Routing logic (NEW — not in the Python engine).
//
// Maps band + hard-stop state to the structured ScorecardNextAction
// enum + a NextActionContent payload (heading + bulleted reasons).
// The engine's legacy `nextAction` string is preserved for the report
// renderer; this module produces the data the modern API consumes.
//
// Polish PR (e57a769 follow-up): the API now returns a structured
// `nextActionContent` object so the results page can render a proper
// bulleted list instead of a cramped run-on paragraph.
//   * `heading`  → bold lead-in sentence
//   * `bullets`  → one bullet per concrete reason / step
//   * `leadIn?`  → optional intro paragraph above the bullets
//                  (reserved for forward-compat; no current scenario
//                  uses it but the frontend renders it when present)
//
// `nextActionTextEn` / `nextActionTextFa` are STILL populated by
// joining heading + " " + bullets.join(" ") so legacy API consumers
// keep working. Old DB rows without nextActionContent are tolerated
// at the frontend (fallback to the flat string).
//
// Hard-stop override (separate polish PR): hard stops apply regardless
// of band — even Bands 1 and 2 — because legal complexity must be
// reviewed by the LIA before nurture content makes sense. The
// scenario-routing decision lives in the FRONTEND (ScorecardResultClient)
// because it depends on UI considerations like which button to show;
// the backend's job here is just to produce the content payload.

import type { BandEnum } from './bands';
import type { HardStop } from './hard-stops';

export type ScorecardNextActionValue =
  | 'NURTURE_ONLY'
  | 'PAY_GAP_CLOSING_SESSION'
  | 'BOOK_FREE_15MIN_SESSION'
  | 'BLOCKED_HARD_STOP';

export interface NextActionContent {
  heading: string;
  bullets: string[];
  leadIn?: string;
}

export interface RoutingDecision {
  nextAction: ScorecardNextActionValue;
  nextActionContent: NextActionContent;
  // Backwards-compatible flat strings (derived from the structured
  // content). Persian mirrors English per Fix 9 — see routing.ts
  // commit history.
  nextActionTextEn: string;
  nextActionTextFa: string;
}

function flatten(content: NextActionContent): string {
  const tail = content.bullets.length > 0 ? ' ' + content.bullets.join(' ') : '';
  const head = content.leadIn ? content.leadIn + ' ' + content.heading : content.heading;
  return head + tail;
}

function decision(
  nextAction: ScorecardNextActionValue,
  content: NextActionContent,
): RoutingDecision {
  const flat = flatten(content);
  return {
    nextAction,
    nextActionContent: content,
    nextActionTextEn: flat,
    nextActionTextFa: flat,
  };
}

export function determineRouting(
  band: BandEnum,
  hardStops: HardStop[],
  _executionEligible: boolean,
): RoutingDecision {
  // Hard stop ALWAYS overrides the band's normal routing. The
  // frontend separately decides which BUTTON to show (LIA for any
  // hard-stop case), but the content payload here describes WHAT
  // needs resolving — one bullet per active hard stop.
  if (hardStops.length > 0) {
    return decision('BLOCKED_HARD_STOP', {
      heading: 'Before we can proceed, we need to resolve:',
      bullets: hardStops.map((h) => `${h.name}: ${h.resolution}`),
    });
  }

  if (band === 'BAND_1' || band === 'BAND_2') {
    return decision('NURTURE_ONLY', {
      heading: 'We have designed a learning pathway tailored to your profile.',
      bullets: [
        'Free resources to help you build readiness over the next 3-6 months.',
        "We'll email you a personalised learning plan.",
      ],
    });
  }

  if (band === 'BAND_3') {
    return decision('PAY_GAP_CLOSING_SESSION', {
      heading: 'Your next step is a NZD 30 Gap-Closing Roadmap Session.',
      bullets: [
        'On payment, an AI-generated improvement plan tailored to your profile is sent to you immediately.',
        "You'll receive a booking link with a language-matched Admission Specialist for a 30-minute session.",
      ],
    });
  }

  // Bands 4, 5, 6 — mandatory free 15-min session
  return decision('BOOK_FREE_15MIN_SESSION', {
    heading: 'You qualify for a free 15-minute consultation with our team.',
    bullets: [
      'After this mandatory session, you may proceed with the NZD 200 account opening to activate full case management.',
      'Your case advisor will confirm your pathway and walk you through the next steps.',
    ],
  });
}
