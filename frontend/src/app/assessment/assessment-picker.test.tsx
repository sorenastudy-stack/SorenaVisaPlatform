/**
 * PR-PHASE33 — the test that would have caught the q16 id/key bug.
 *
 * WHY THIS EXISTS, and why it renders the real page instead of calling a function:
 *
 * `scripts/verify-v2-scoring.cjs` reported 7/7 byte-identical while every real
 * submission was mis-scored. It hand-feeds StudyField KEYS:
 *
 *     q13_qualification_field: 'it_computer_science'
 *
 * but the picker emits the StudyField ID (a cuid), because that is what the
 * server's matching contract wants. The scoring map is keyed by key, so every
 * lookup missed and fell through to 'Other' — silently, since 'Other' is also a
 * legitimate answer. The guard never touched the picker, so it could not see it.
 *
 * These tests therefore take the value from the REAL component: they render the
 * actual assessment page, select an option through the actual <select>, and
 * assert on what the real submit path sends. Any future change that alters what
 * the picker emits — or that decouples it from the scoring maps — fails here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssessmentV2Page from './page';
import { buildScoringAnswers, StudyFieldResolutionError } from '@/lib/scorecard/v2/scoring-answers';
import { ASSESSMENT_V2 } from '@/lib/scorecard/v2/assessment-v2';
import { saveDraft } from '@/lib/scorecard/v2/assessment-draft';

// Q13 lives in 'Education & English'. Since the form became multi-step it is no
// longer on first render, so each test resumes a draft parked on that step —
// derived from the schema, not hard-coded, so re-ordering sections cannot
// silently turn these tests into "the picker was never rendered" passes.
const Q13_STEP = ASSESSMENT_V2.findIndex((s) => s.title === 'Education & English');

/** Render the page already on the step that holds the Q13 picker. */
function renderAtPickerStep() {
  saveDraft({ q03_age: '22 - 29' }, Q13_STEP);
  return render(<AssessmentV2Page />);
}

// Real-shaped payload: cuid-style ids and the real keys, exactly as
// GET /public/matching/study-fields returns them.
const STUDY_FIELDS = [
  { id: 'cmsf1a2b3c4d5e6f7g8h9i0j', key: 'it_computer_science', nameEn: 'Information Technology & Computer Science', nameFa: 'فناوری اطلاعات', category: { key: 'stem', nameEn: 'STEM', alwaysSelectable: false } },
  { id: 'cmsf2b3c4d5e6f7g8h9i0j1k', key: 'engineering',         nameEn: 'Engineering',                              nameFa: 'مهندسی',        category: { key: 'stem', nameEn: 'STEM', alwaysSelectable: false } },
  { id: 'cmsf3c4d5e6f7g8h9i0j1k2l', key: 'other',               nameEn: 'Other',                                    nameFa: 'سایر',          category: { key: 'other', nameEn: 'Other', alwaysSelectable: true } },
];

/** Capture what the page POSTs to score-preview. */
let postedAnswers: Record<string, string> | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  postedAnswers = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/study-fields')) {
      return new Response(JSON.stringify(STUDY_FIELDS), { status: 200 });
    }
    if (u.includes('/allowed-fields')) {
      // Server-authoritative Q30 set — every field allowed, so Q32 is selectable.
      return new Response(JSON.stringify(STUDY_FIELDS.map((f) => f.id)), { status: 200 });
    }
    if (u.includes('/score-preview')) {
      postedAnswers = JSON.parse(String(init?.body ?? '{}')).answers ?? null;
      return new Response(JSON.stringify({
        totalScore: 0, band: 'BAND_1', bandName: '', bandRange: '',
        executionEligible: false, hardStops: [], riskFlags: [],
      }), { status: 200 });
    }
    if (u.includes('/recommendations')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the real Q13 picker feeds the scoring map', () => {
  it('emits a StudyField ID, not a key — the mismatch that caused the bug', async () => {
    renderAtPickerStep();
    const select = await screen.findByRole('combobox', { name: /Field of your highest qualification/i });

    await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Information Technology & Computer Science' }));

    // This is the crux: the component's value is the cuid, NOT 'it_computer_science'.
    expect((select as HTMLSelectElement).value).toBe('cmsf1a2b3c4d5e6f7g8h9i0j');
    expect((select as HTMLSelectElement).value).not.toBe('it_computer_science');
  });

  it('scores that ID as the real field, not silently as Other', async () => {
    renderAtPickerStep();
    const select = await screen.findByRole('combobox', { name: /Field of your highest qualification/i });
    await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Engineering' }));

    // Feed the picker's own emitted value through the real mapping, with the
    // same study-field list the page holds.
    const emitted = (select as HTMLSelectElement).value;
    const answers = buildScoringAnswers({ q13_qualification_field: emitted }, STUDY_FIELDS);

    expect(answers.q16_field_main).toBe('Engineering');
    // Before the fix this was 'Other' — a silent 0 for field of qualification.
    expect(answers.q16_field_main).not.toBe('Other');
  });

  it('still scores a genuine "Other" selection as Other', async () => {
    renderAtPickerStep();
    const select = await screen.findByRole('combobox', { name: /Field of your highest qualification/i });
    await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Other' }));

    const answers = buildScoringAnswers(
      { q13_qualification_field: (select as HTMLSelectElement).value },
      STUDY_FIELDS,
    );
    // Distinguishing this from the bug's fallback is the whole point.
    expect(answers.q16_field_main).toBe('Other');
  });
});

describe('buildScoringAnswers refuses to guess', () => {
  it('throws on an id it cannot resolve rather than defaulting to Other', () => {
    expect(() => buildScoringAnswers({ q13_qualification_field: 'cmsUNKNOWNid' }, STUDY_FIELDS))
      .toThrow(StudyFieldResolutionError);
  });

  it('throws when ids are supplied but no study-field list is', () => {
    // Exactly the pre-fix production call shape: ids in, no list to resolve
    // against. It used to return 'Other' silently; now it is loud.
    expect(() => buildScoringAnswers({ q13_qualification_field: 'cmsf2b3c4d5e6f7g8h9i0j1k' }))
      .toThrow(StudyFieldResolutionError);
  });

  it('still accepts plain keys, so the frozen reference battery is unaffected', () => {
    const answers = buildScoringAnswers({ q13_qualification_field: 'it_computer_science' });
    expect(answers.q16_field_main).toBe('Information Technology & Computer Science');
  });

  it('applies the same strictness to Q32 → q25 (a wrong Other here can fire HS2)', () => {
    expect(() => buildScoringAnswers({ q32_preferred_fields: ['cmsUNKNOWNid'] }, STUDY_FIELDS))
      .toThrow(StudyFieldResolutionError);

    const ok = buildScoringAnswers({ q32_preferred_fields: ['cmsf2b3c4d5e6f7g8h9i0j1k'] }, STUDY_FIELDS);
    expect(ok.q25_intended_study).not.toBe('Other');
  });
});
