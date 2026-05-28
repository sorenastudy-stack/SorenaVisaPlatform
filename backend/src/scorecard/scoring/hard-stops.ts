// PR-SCORECARD-1 — verbatim port of detect_hard_stops().
//
// Source: Sorena_Scoring_Reference/sorena_scoring.py lines 362-437.
// Six rules HS1..HS6 — same predicates, same code/name/reason/resolution
// strings. Do NOT reorder the rules — the spec checks "the first hard
// stop" for routing fallback, and the Python preserves declaration order.

export interface HardStop {
  code: 'HS1' | 'HS2' | 'HS3' | 'HS4' | 'HS5' | 'HS6';
  name: string;
  reason: string;
  resolution: string;
}

export function detectHardStops(answers: Record<string, string>): HardStop[] {
  const hs: HardStop[] = [];

  // HS1 — No realistic funding path
  const funds = answers.q33_funds ?? '';
  const finDocs = answers.q36_financial_docs ?? '';
  if (
    funds === 'Less than NZD 10,000'
    || (funds === 'NZD 10,000 - 20,000' && finDocs === 'No')
  ) {
    hs.push({
      code: 'HS1',
      name: 'No Realistic Funding Path',
      reason: 'Available funds are below the minimum threshold for a realistic NZ study application.',
      resolution: 'Financial readiness planning. Re-assess once funds are documentable above NZD 20,000.',
    });
  }

  // HS2 — No usable academic direction
  const qual = answers.q15_highest_qual ?? '';
  const studyArea = answers.q25_intended_study ?? '';
  if (qual === 'High School' && (studyArea === 'Other' || studyArea === '')) {
    hs.push({
      code: 'HS2',
      name: 'No Usable Academic Direction',
      reason: 'No defined study goal combined with minimal academic foundation.',
      resolution: 'Specialist Admission Consultation (NZD 50). Roadmap session before any execution.',
    });
  }

  // HS3 — Severe English unreadiness
  if (
    answers.q22_english_score === 'Below IELTS 5'
    && answers.q21_english_cert === 'No certificate'
  ) {
    hs.push({
      code: 'HS3',
      name: 'Severe English Unreadiness',
      reason: 'English level is below the minimum for any direct-entry programme.',
      resolution: 'Language school pathway or long-term English nurture. Re-assess in 3-6 months.',
    });
  }

  // HS4 — Visa/legal complexity requiring LIA
  const refusal = answers.q44_refusal === 'Yes';
  const refusalCount = answers.q45_refusal_count ?? '';
  const recency = answers.q46_refusal_recency ?? '';
  const breach = answers.q49_breach === 'Yes';
  const fakeIdentity = answers.q50_other_identity === 'Yes';
  if (
    (refusal && (refusalCount === '2' || refusalCount === '3 or more'))
    || (refusal && recency === 'Less than 6 months ago')
    || breach
    || fakeIdentity
  ) {
    hs.push({
      code: 'HS4',
      name: 'Visa / Legal Complexity Requiring LIA',
      reason: 'Prior refusal pattern, recent refusal, breach, or identity issue detected.',
      resolution: 'LIA Consultation (NZD 150). All progression blocked until LIA clears.',
    });
  }

  // HS5 — Unrealistic timeline
  if (
    answers.q41_apply_timeline === 'Immediately'
    && (answers.q40_docs_ready === 'Not ready' || answers.q39_passport === 'No')
  ) {
    hs.push({
      code: 'HS5',
      name: 'Unrealistic Timeline',
      reason: 'Wants immediate application but documents or passport are not ready.',
      resolution: 'Reality calibration session. Client must accept realistic timeline.',
    });
  }

  // HS6 — Serious medical (manual review)
  if (answers.q47_medical === 'Serious / unresolved') {
    hs.push({
      code: 'HS6',
      name: 'Serious Medical Condition - Manual Review',
      reason: 'Self-disclosed serious / unresolved medical condition.',
      resolution: 'LIA / medical assessment required before any application.',
    });
  }

  return hs;
}
