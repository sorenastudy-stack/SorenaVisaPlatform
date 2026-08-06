/* PR-PHASE33 — v2 assessment byte-identity guard.
 *
 * Proves the redesigned (v2) assessment form produces SCORING output identical to
 * the frozen reference battery: reference profiles expressed as v2 form state →
 * buildScoringAnswers (the v2 mapping) → the REAL backend scoring engine → assert
 * the golden total/band/eligibility/hard-stops. Complements the backend CI gate
 * (backend/src/scorecard/scoring/scoring.spec.ts), which guards the engine itself.
 *
 * Run from the frontend dir (needs the backend built: `cd ../backend && npm run build`):
 *   node scripts/verify-v2-scoring.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.resolve(__dirname, '..');
const BACKEND = path.resolve(FRONTEND, '..', 'backend');
const OUT = path.join(FRONTEND, 'node_modules', '.cache', 'v2-verify');
const ENGINE = path.join(BACKEND, 'dist', 'scorecard', 'scoring', 'engine.js');

if (!fs.existsSync(ENGINE)) {
  console.error('Backend not built — run `cd ../backend && npm run build` first.');
  process.exit(2);
}

fs.rmSync(OUT, { recursive: true, force: true });
execSync(
  `npx tsc --module commonjs --target es2020 --esModuleInterop --skipLibCheck ` +
  `--rootDir src/lib/scorecard --outDir "${OUT}" ` +
  `src/lib/scorecard/submit-helpers.ts src/lib/scorecard/v2/study-field-maps.ts ` +
  `src/lib/scorecard/v2/scoring-answers.ts`,
  { cwd: FRONTEND, stdio: 'inherit' },
);

const { score } = require(ENGINE);
const { buildScoringAnswers } = require(path.join(OUT, 'v2', 'scoring-answers.js'));

const MARYAM_V2 = {
  q01_motivation: 'Very High', q02_migrate_before_family: 'Yes', q03_age: '22 - 29',
  q05_military: 'Not applicable', q06_marital: 'Single', q08_children: '0',
  q12_other_citizenship: 'No', q13_travel_history: 'Multiple visa-requiring countries',
  q14_visa_countries_type: 'Yes - Tier-1 countries (NZ / AU / UK / US / CA / Schengen)',
  q15_highest_qual: 'Bachelor', q17_gpa: 'Good (above average)', q18_years_since: '2 - 5 years',
  q19_docs_translated: 'Yes - fully translated', q20_publications: 'No',
  q21_english_cert: 'IELTS Academic', q22_english_score: 'IELTS 6 - 6.5', q24_studied_english: 'Yes',
  q26_field_change: 'No', q27_study_goal: 'Career progression in my current field',
  q28_work_after_grad: 'Yes', q29_years_work: '3 - 5 years', q30_work_relevance: 'Fully related',
  q31_occupation: 'Information Technology & Software',
  q33_funds: 'NZD 40,000 - 60,000', q34_funds_source: 'Personal savings', q35_overseas_bank: 'Yes',
  q36_financial_docs: 'Yes - fully', q37_overseas_contacts: 'Yes', q38_settlement_support: 'Yes',
  q39_passport: 'Yes', q40_docs_ready: 'Fully ready', q41_apply_timeline: 'Within 1 month',
  q44_refusal: 'No', q47_medical: 'No major issues', q48_police_clearance: 'Yes',
  q49_breach: 'No', q50_other_identity: 'No', q51_self_submitted: 'No', q52_other_agent: 'No',
  q04_gender: 'Female',
  q13_qualification_field: 'it_computer_science', q32_preferred_fields: ['it_computer_science'],
};
const BORDERLINE_V2 = {
  ...MARYAM_V2, q15_highest_qual: 'Diploma', q17_gpa: 'Average', q18_years_since: '10+ years',
  q19_docs_translated: 'Partially', q21_english_cert: 'No certificate', q22_english_score: 'No test taken',
  q24_studied_english: 'No', q27_study_goal: 'English language only', q28_work_after_grad: 'No',
  q29_years_work: 'None', q30_work_relevance: 'Unrelated', q31_occupation: 'Unemployed',
  q41_apply_timeline: 'Within 3 months', q13_qualification_field: 'other',
};
const mk = (o) => ({ ...MARYAM_V2, ...o });

// ── the REAL UI path ────────────────────────────────────────────────────────
// Every profile above is written in StudyField KEYS, because keys are stable and
// cuids are not. But the picker emits the StudyField **id** (that is what the
// server's matching contract wants), so a key-only battery never exercises the
// path a real applicant takes. That gap is exactly how the q16 id/key bug scored
// 7/7 here while every real submission silently resolved to 'Other'.
//
// This list mirrors src/app/assessment/assessment-picker.test.tsx so the two
// layers agree on what the server returns.
const STUDY_FIELDS = [
  { id: 'cmsf1a2b3c4d5e6f7g8h9i0j', key: 'it_computer_science' },
  { id: 'cmsf2b3c4d5e6f7g8h9i0j1k', key: 'engineering' },
  { id: 'cmsf3c4d5e6f7g8h9i0j1k2l', key: 'other' },
];
// The id profile is built on BORDERLINE, not Maryam, and that choice matters.
// Maryam's category 2 is above its cap, so losing the 4-point field score is
// absorbed and her total stays 100 either way — an id profile there passes even
// with the bug present (verified: it did). Borderline sits below the cap, so the
// field score is visible in the total: 'other' = 78, a real field = 82.
const BORDERLINE_BY_ID = {
  ...BORDERLINE_V2,
  q13_qualification_field: 'cmsf1a2b3c4d5e6f7g8h9i0j', // it_computer_science
  q32_preferred_fields: ['cmsf1a2b3c4d5e6f7g8h9i0j'],
};
const CASES = [
  { name: 'Maryam',          state: MARYAM_V2,     total: 100, band: 'BAND_6', elig: true,  hs: [] },
  { name: 'Borderline-gate', state: BORDERLINE_V2, total: 78,  band: 'BAND_5', elig: true,  hs: [] },
  { name: 'HS1 funding',     state: mk({ q33_funds: 'Less than NZD 10,000' }), total: 100, band: 'BAND_6', elig: false, hs: ['HS1'] },
  { name: 'HS3 english',     state: mk({ q21_english_cert: 'No certificate', q22_english_score: 'Below IELTS 5' }), total: 100, band: 'BAND_6', elig: false, hs: ['HS3'] },
  { name: 'HS4 legal',       state: mk({ q49_breach: 'Yes' }), total: 100, band: 'BAND_6', elig: false, hs: ['HS4'] },
  { name: 'HS5 timeline',    state: mk({ q41_apply_timeline: 'Immediately', q40_docs_ready: 'Not ready' }), total: 100, band: 'BAND_6', elig: false, hs: ['HS5'] },
  { name: 'HS6 medical',     state: mk({ q47_medical: 'Serious / unresolved' }), total: 99, band: 'BAND_6', elig: false, hs: ['HS6'] },
  // Reached through the ids the picker actually emits. If id→key resolution
  // breaks again, q16 falls back to 'Other' and this total drops 82 → 78, so
  // the guard fails instead of quietly passing.
  { name: 'Borderline (picker ids)', state: BORDERLINE_BY_ID, fields: STUDY_FIELDS, total: 82, band: 'BAND_5', elig: true, hs: [] },
];
let ok = true;
for (const c of CASES) {
  const r = score(buildScoringAnswers(c.state, c.fields));
  const pass = r.total === c.total && r.band.enumValue === c.band && r.execution.eligible === c.elig
    && JSON.stringify(r.hardStops.map((h) => h.code)) === JSON.stringify(c.hs);
  if (!pass) ok = false;
  console.log(`${pass ? 'OK ' : 'XX '} ${c.name.padEnd(18)} total=${r.total} ${r.band.enumValue} elig=${r.execution.eligible} hs=[${r.hardStops.map((h) => h.code)}]`);
}
// ── regression guard for the bug itself ─────────────────────────────────────
// Ids with no study-field list to resolve against is precisely the pre-fix
// production call shape. It used to return 'Other' silently; it must now be loud.
// Without this, someone could "fix" a future failure by restoring the fallback
// and the battery would go green again while every applicant is mis-scored.
try {
  buildScoringAnswers({ q13_qualification_field: 'cmsf1a2b3c4d5e6f7g8h9i0j' });
  console.log('XX  unresolvable id silently accepted — the id/key bug is back');
  ok = false;
} catch {
  console.log('OK  unresolvable id rejected  (no silent fallback to Other)');
}

console.log('\nv2 form → real engine BYTE-IDENTICAL:', ok);
process.exit(ok ? 0 : 1);
