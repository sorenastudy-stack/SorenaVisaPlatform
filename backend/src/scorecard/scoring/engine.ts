// PR-SCORECARD-1 — verbatim port of the main score() function.
//
// Source: Sorena_Scoring_Reference/sorena_scoring.py lines 528-594.
//
// Key behaviours preserved exactly:
//   * Missing / "-- Select --" treated as no points + tracked as
//     missing (only when the field is in FIELD_CATEGORIES)
//   * Exact-match lookup first, then case-insensitive whitespace-
//     trimmed fallback
//   * Per-category sub-totals computed RAW, then capped at CATEGORY_MAX
//     for both display and the grand total
//   * Grand total additionally capped at 100
//   * next_action string format identical to the Python (used by the
//     legacy report renderer); the new routing.ts file produces the
//     structured action enum + Persian text for the API response.

import {
  CATEGORY_MAX,
  CATEGORY_NAMES,
  FIELD_CATEGORIES,
  SCORES,
} from './scores';
import { bandFor, BandInfo } from './bands';
import { detectHardStops, HardStop } from './hard-stops';
import { detectRiskFlags } from './risk-flags';
import { checkExecutionGates, GateCheck } from './gates';

export interface PerFieldScore {
  answer: string;
  points: number;
}

export interface ScoreResult {
  answers: Record<string, string>;
  perFieldScores: Record<string, PerFieldScore>;
  catScores: Record<number, number>;     // capped
  catScoresRaw: Record<number, number>;  // pre-cap
  catMax: typeof CATEGORY_MAX;
  catNames: typeof CATEGORY_NAMES;
  total: number;
  band: BandInfo;
  hardStops: HardStop[];
  riskFlags: string[];
  execution: GateCheck;
  nextAction: string;
  missingCount: number;
}

export function score(answers: Record<string, string>): ScoreResult {
  const perFieldScores: Record<string, PerFieldScore> = {};
  const catScores: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const missing: string[] = [];

  for (const field of Object.keys(SCORES)) {
    const options = SCORES[field];
    const raw = (answers[field] ?? '').trim();
    if (!raw || raw === '-- Select --') {
      perFieldScores[field] = { answer: raw || '(not answered)', points: 0 };
      if (FIELD_CATEGORIES[field]) {
        missing.push(field);
      }
      continue;
    }

    // Exact match first.
    let pts: number | undefined = options[raw];
    // Relaxed fallback — case-insensitive + whitespace-trimmed.
    if (pts === undefined) {
      for (const [k, v] of Object.entries(options)) {
        if (k.trim().toLowerCase() === raw.toLowerCase()) {
          pts = v;
          break;
        }
      }
    }
    if (pts === undefined) pts = 0;

    perFieldScores[field] = { answer: raw, points: pts };
    const cat = FIELD_CATEGORIES[field];
    if (cat) {
      catScores[cat] += pts;
    }
  }

  // Cap per-category, then sum, then cap total at 100.
  const catScoresCapped: Record<number, number> = {
    1: Math.min(catScores[1], CATEGORY_MAX[1]),
    2: Math.min(catScores[2], CATEGORY_MAX[2]),
    3: Math.min(catScores[3], CATEGORY_MAX[3]),
    4: Math.min(catScores[4], CATEGORY_MAX[4]),
  };
  let total = catScoresCapped[1] + catScoresCapped[2] + catScoresCapped[3] + catScoresCapped[4];
  total = Math.min(total, 100);

  const hardStops = detectHardStops(answers);
  const riskFlags = detectRiskFlags(answers, catScoresCapped);
  const band = bandFor(total);
  const execution = checkExecutionGates(total, catScoresCapped, hardStops, answers);

  // Legacy next_action string (used by the Python report renderer;
  // routing.ts produces the structured enum + Persian text for the
  // API response).
  let nextAction: string;
  if (hardStops.length > 0) {
    nextAction = `Resolve ${hardStops[0].code}: ${hardStops[0].name}. ${hardStops[0].resolution}`;
  } else if (execution.eligible) {
    nextAction = 'Book free 15-minute session, then Account Opening (USD 200).';
  } else if (band.number === '3') {
    nextAction = 'Offer Gap-Closing Session (NZD 30) + Admission Consultation (NZD 50).';
  } else if (band.number === '4') {
    nextAction = 'Offer free 15-minute session to qualify for Account Opening.';
  } else if (band.number === '1' || band.number === '2') {
    nextAction = 'Place into nurture sequence. Webinar invitation. Re-assess in 3–6 months.';
  } else {
    nextAction = 'Manual review.';
  }

  return {
    answers,
    perFieldScores,
    catScores: catScoresCapped,
    catScoresRaw: catScores,
    catMax: CATEGORY_MAX,
    catNames: CATEGORY_NAMES,
    total,
    band,
    hardStops,
    riskFlags,
    execution,
    nextAction,
    missingCount: missing.length,
  };
}
