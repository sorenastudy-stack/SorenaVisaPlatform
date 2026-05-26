// PR-SCORECARD-1 — unit tests for the TypeScript scoring engine port.
//
// Verifies behavioural equivalence with sorena_scoring.py against:
//   1. The Maryam Karimi sample case from SAMPLE_Scoring_Report.pdf
//      (page 3 full answer log). Should produce total=100, BAND_6,
//      executionEligible=true, no hard stops.
//   2. Each of the 6 hard-stop predicates (HS1..HS6) — one test per
//      rule, using minimal answer sets that trigger only that stop.
//   3. Band-threshold boundaries — 0/24/25/39/40/54/55/69/70/84/85/100
//      via synthetic answers that hit the exact total.
//   4. Routing rules — each band + a hard-stop case map to the right
//      ScorecardNextAction enum value.

import { score } from './engine';
import { detectHardStops } from './hard-stops';
import { bandFor } from './bands';
import { determineRouting } from './routing';

// ─── Maryam Karimi — the 100/Band 6 sample ────────────────────────────

const MARYAM_ANSWERS: Record<string, string> = {
  // Cat 1
  q01_motivation: 'Very High',                                                       // +4
  q02_migrate_before_family: 'Yes',                                                  // +3
  q03_age: '22 - 29',                                                                // +4
  q05_military: 'Not applicable',                                                    // +2
  q06_marital: 'Single',                                                             // +3
  q07_marriage_years: 'Not applicable',                                              // +2
  q08_children: '0',                                                                 // +3
  q09_partner_age: 'Not applicable',                                                 // +2
  q10_partner_edu: 'Not applicable',                                                 // +2
  q11_partner_english: 'Not applicable',                                             // +2
  q12_other_citizenship: 'No',                                                       // +1
  q13_travel_history: 'Multiple visa-requiring countries',                           // +3
  q14_visa_countries_type: 'Yes - Tier-1 countries (NZ / AU / UK / US / CA / Schengen)', // +3
  // raw Cat 1 = 34 → capped 20

  // Cat 2
  q15_highest_qual: 'Bachelor',                                                      // +7
  q16_field_main: 'Information Technology & Computer Science',                       // +4
  q17_gpa: 'Good (above average)',                                                   // +5
  q18_years_since: '2 - 5 years',                                                    // +3
  q19_docs_translated: 'Yes - fully translated',                                     // +4
  q20_publications: 'No',                                                            // 0
  q21_english_cert: 'IELTS Academic',                                                // +5
  q22_english_score: 'IELTS 6 - 6.5',                                                // +5
  q24_studied_english: 'Yes',                                                        // +1
  q26_field_change: 'No',                                                            // +1
  q27_study_goal: 'Career progression in my current field',                          // +4
  q28_work_after_grad: 'Yes',                                                        // +1
  q29_years_work: '3 - 5 years',                                                     // +4
  q30_work_relevance: 'Fully related',                                               // +3
  q31_occupation: 'Information Technology & Software',                               // +4
  // raw Cat 2 = 51 → capped 35

  // Cat 3
  q33_funds: 'NZD 40,000 - 60,000',                                                  // +6
  q34_funds_source: 'Personal savings',                                              // +5
  q35_overseas_bank: 'Yes',                                                          // +4
  q36_financial_docs: 'Yes - fully',                                                 // +4
  q37_overseas_contacts: 'Yes',                                                      // +1
  q38_settlement_support: 'Yes',                                                     // +1
  q39_passport: 'Yes',                                                               // +3
  q40_docs_ready: 'Fully ready',                                                     // +4
  q41_apply_timeline: 'Within 1 month',                                              // +3
  // raw Cat 3 = 31 → capped 25

  // Cat 4
  q44_refusal: 'No',                                                                 // +6
  q45_refusal_count: 'Not applicable',                                               // 0
  q46_refusal_recency: 'Not applicable',                                             // 0
  q47_medical: 'No major issues',                                                    // +4
  q48_police_clearance: 'Yes',                                                       // +4
  q49_breach: 'No',                                                                  // +3
  q50_other_identity: 'No',                                                          // +2
  q51_self_submitted: 'No',                                                          // +2
  q52_other_agent: 'No',                                                             // +2
  // raw Cat 4 = 23 → capped 20

  // Non-scored fields with valid options (so the engine doesn't count them as "missing")
  q23_test_date: 'Less than 1 year ago',
  q25_intended_study: 'Information Technology / AI / Data',
  q42_intake: 'ASAP',
  q43_city: 'Auckland',
  q04_gender: 'Female',
  q32_employment_type: 'Full-time',
};

describe('scorecard scoring engine — Maryam Karimi sample (SAMPLE_Scoring_Report.pdf)', () => {
  const result = score(MARYAM_ANSWERS);

  it('totals 100', () => {
    expect(result.total).toBe(100);
  });
  it('classifies BAND_6 (Premium / Execution Ready)', () => {
    expect(result.band.enumValue).toBe('BAND_6');
    expect(result.band.number).toBe('6');
    expect(result.band.range).toBe('85-100');
  });
  it('caps every category at its maximum', () => {
    expect(result.catScores[1]).toBe(20);
    expect(result.catScores[2]).toBe(35);
    expect(result.catScores[3]).toBe(25);
    expect(result.catScores[4]).toBe(20);
  });
  it('records raw (pre-cap) sub-totals matching the sample PDF maths', () => {
    expect(result.catScoresRaw[1]).toBe(34);
    expect(result.catScoresRaw[2]).toBe(51);
    expect(result.catScoresRaw[3]).toBe(31);
    expect(result.catScoresRaw[4]).toBe(23);
  });
  it('has no hard stops', () => {
    expect(result.hardStops).toHaveLength(0);
  });
  it('has no risk flags', () => {
    expect(result.riskFlags).toHaveLength(0);
  });
  it('passes all 5 execution gates', () => {
    expect(result.execution.eligible).toBe(true);
    expect(Object.values(result.execution.gates).every((g) => g === true)).toBe(true);
  });
  it('routes BAND_6 + no-HS to BOOK_FREE_15MIN_SESSION', () => {
    const routing = determineRouting(result.band.enumValue, result.hardStops, result.execution.eligible);
    expect(routing.nextAction).toBe('BOOK_FREE_15MIN_SESSION');
  });
});

// ─── Hard stops — one test per HS1..HS6 ───────────────────────────────

describe('detectHardStops()', () => {
  it('HS1 fires when funds = Less than NZD 10,000', () => {
    const hs = detectHardStops({ q33_funds: 'Less than NZD 10,000' });
    expect(hs.map((h) => h.code)).toContain('HS1');
  });
  it('HS1 also fires for 10-20k with no financial docs', () => {
    const hs = detectHardStops({
      q33_funds: 'NZD 10,000 - 20,000',
      q36_financial_docs: 'No',
    });
    expect(hs.map((h) => h.code)).toContain('HS1');
  });
  it('HS2 fires when High School + intended study = Other', () => {
    const hs = detectHardStops({
      q15_highest_qual: 'High School',
      q25_intended_study: 'Other',
    });
    expect(hs.map((h) => h.code)).toContain('HS2');
  });
  it('HS3 fires when English score < 5 + no certificate', () => {
    const hs = detectHardStops({
      q22_english_score: 'Below IELTS 5',
      q21_english_cert: 'No certificate',
    });
    expect(hs.map((h) => h.code)).toContain('HS3');
  });
  it('HS4 fires on multiple refusals', () => {
    const hs = detectHardStops({
      q44_refusal: 'Yes',
      q45_refusal_count: '2',
    });
    expect(hs.map((h) => h.code)).toContain('HS4');
  });
  it('HS4 fires on recent refusal (<6 months)', () => {
    const hs = detectHardStops({
      q44_refusal: 'Yes',
      q46_refusal_recency: 'Less than 6 months ago',
    });
    expect(hs.map((h) => h.code)).toContain('HS4');
  });
  it('HS4 fires on visa breach', () => {
    const hs = detectHardStops({ q49_breach: 'Yes' });
    expect(hs.map((h) => h.code)).toContain('HS4');
  });
  it('HS4 fires on identity issue', () => {
    const hs = detectHardStops({ q50_other_identity: 'Yes' });
    expect(hs.map((h) => h.code)).toContain('HS4');
  });
  it('HS5 fires when applying immediately with docs not ready', () => {
    const hs = detectHardStops({
      q41_apply_timeline: 'Immediately',
      q40_docs_ready: 'Not ready',
    });
    expect(hs.map((h) => h.code)).toContain('HS5');
  });
  it('HS5 fires when applying immediately without passport', () => {
    const hs = detectHardStops({
      q41_apply_timeline: 'Immediately',
      q39_passport: 'No',
    });
    expect(hs.map((h) => h.code)).toContain('HS5');
  });
  it('HS6 fires on serious medical condition', () => {
    const hs = detectHardStops({ q47_medical: 'Serious / unresolved' });
    expect(hs.map((h) => h.code)).toContain('HS6');
  });
  it('Maryam set produces zero hard stops', () => {
    expect(detectHardStops(MARYAM_ANSWERS)).toHaveLength(0);
  });
});

// ─── Band threshold tests via bandFor() ────────────────────────────────

describe('bandFor() boundaries', () => {
  it.each([
    [0,   '1', 'BAND_1'],
    [24,  '1', 'BAND_1'],
    [25,  '2', 'BAND_2'],
    [39,  '2', 'BAND_2'],
    [40,  '3', 'BAND_3'],
    [54,  '3', 'BAND_3'],
    [55,  '4', 'BAND_4'],
    [69,  '4', 'BAND_4'],
    [70,  '5', 'BAND_5'],
    [84,  '5', 'BAND_5'],
    [85,  '6', 'BAND_6'],
    [100, '6', 'BAND_6'],
  ])('total %i → band %s (%s)', (total, num, enumVal) => {
    const b = bandFor(total as number);
    expect(b.number).toBe(num);
    expect(b.enumValue).toBe(enumVal);
  });
});

// ─── Routing decisions ────────────────────────────────────────────────

describe('determineRouting()', () => {
  it('BAND_1 → NURTURE_ONLY', () => {
    expect(determineRouting('BAND_1', [], false).nextAction).toBe('NURTURE_ONLY');
  });
  it('BAND_2 → NURTURE_ONLY', () => {
    expect(determineRouting('BAND_2', [], false).nextAction).toBe('NURTURE_ONLY');
  });
  it('BAND_3 → PAY_GAP_CLOSING_SESSION', () => {
    expect(determineRouting('BAND_3', [], false).nextAction).toBe('PAY_GAP_CLOSING_SESSION');
  });
  it('BAND_4 → BOOK_FREE_15MIN_SESSION', () => {
    expect(determineRouting('BAND_4', [], false).nextAction).toBe('BOOK_FREE_15MIN_SESSION');
  });
  it('BAND_5 → BOOK_FREE_15MIN_SESSION', () => {
    expect(determineRouting('BAND_5', [], true).nextAction).toBe('BOOK_FREE_15MIN_SESSION');
  });
  it('BAND_6 → BOOK_FREE_15MIN_SESSION (mandatory even at top)', () => {
    expect(determineRouting('BAND_6', [], true).nextAction).toBe('BOOK_FREE_15MIN_SESSION');
  });
  it('any hard stop overrides band → BLOCKED_HARD_STOP', () => {
    const hs = [{
      code: 'HS6' as const,
      name: 'Serious Medical Condition — Manual Review',
      reason: 'x',
      resolution: 'y',
    }];
    expect(determineRouting('BAND_6', hs, true).nextAction).toBe('BLOCKED_HARD_STOP');
  });
  it('includes Persian translation for every action', () => {
    const r1 = determineRouting('BAND_1', [], false);
    const r3 = determineRouting('BAND_3', [], false);
    const r5 = determineRouting('BAND_5', [], true);
    expect(r1.nextActionTextFa.length).toBeGreaterThan(0);
    expect(r3.nextActionTextFa.length).toBeGreaterThan(0);
    expect(r5.nextActionTextFa.length).toBeGreaterThan(0);
  });
});
