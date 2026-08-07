/**
 * PR-PHASE33-STEPS — the multi-step gate.
 *
 * Everything here drives the real page: click Next, click Back, click a
 * progress dot. A test that called validateStep() directly would prove the
 * function works and say nothing about whether the button is wired to it —
 * which is the half that actually breaks.
 *
 * The four behaviours the step model has to get right:
 *   1. Next is refused while a required answer on THIS step is empty.
 *   2. Back is never refused, even from an invalid step.
 *   3. Submit re-checks EVERY step, because a later answer can reveal a
 *      required field on an earlier one.
 *   4. A refresh resumes on the step the applicant was on, not step 1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssessmentV2Page from './page';
import { ASSESSMENT_V2, type V2FieldDef } from '@/lib/scorecard/v2/assessment-v2';
import {
  TOTAL_STEPS, DECLARATION_STEP, STEP_TITLES, validateAll, clampStep,
} from '@/lib/scorecard/v2/assessment-steps';
import { saveDraft, loadDraft, DRAFT_KEY } from '@/lib/scorecard/v2/assessment-draft';

const STUDY_FIELDS = [
  { id: 'cmsf1a2b3c4d5e6f7g8h9i0j', key: 'it_computer_science', nameEn: 'Information Technology & Computer Science', nameFa: '', category: { key: 'stem', nameEn: 'STEM', alwaysSelectable: false } },
  { id: 'cmsf2b3c4d5e6f7g8h9i0j1k', key: 'engineering',         nameEn: 'Engineering',                              nameFa: '', category: { key: 'stem', nameEn: 'STEM', alwaysSelectable: false } },
];

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/study-fields')) return new Response(JSON.stringify(STUDY_FIELDS), { status: 200 });
    if (u.includes('/allowed-fields')) return new Response(JSON.stringify(STUDY_FIELDS.map((f) => f.id)), { status: 200 });
    if (u.includes('/score-preview')) {
      return new Response(JSON.stringify({
        totalScore: 50, band: 'BAND_3', bandName: 'Developing', bandRange: '',
        executionEligible: false, hardStops: [], riskFlags: [],
      }), { status: 200 });
    }
    if (u.includes('/recommendations')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

/** Answers satisfying every required+visible field, derived from the schema. */
function completeAnswers(): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  const fill = (f: V2FieldDef) => {
    switch (f.type) {
      case 'select':           a[f.key] = f.options?.[0] ?? 'x'; break;
      case 'studyfield':       a[f.key] = STUDY_FIELDS[0].id; break;
      case 'studyfield-multi': a[f.key] = [STUDY_FIELDS[0].id]; break;
      case 'boolean':          a[f.key] = true; break;
      case 'number':           a[f.key] = 1; break;
      case 'email':            a[f.key] = 'applicant@example.com'; break;
      case 'phone':            a[f.key] = '+64215551234'; break;
      case 'country':          a[f.key] = 'IR'; break;
      default:                 a[f.key] = 'Test'; break;
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const s of ASSESSMENT_V2) {
      for (const q of s.questions) {
        for (const f of q.fields) {
          if (!f.required) continue;
          if (f.visibleWhen && !f.visibleWhen(a)) continue;
          if (a[f.key] === undefined) fill(f);
        }
      }
    }
  }
  return a;
}

const next = () => screen.getByRole('button', { name: 'Next' });
const back = () => screen.getByRole('button', { name: 'Back' });
const stepHeading = () => screen.getByRole('progressbar').getAttribute('aria-label');

describe('the step model itself', () => {
  it('is 7 content steps plus a declaration', () => {
    expect(ASSESSMENT_V2).toHaveLength(7);
    expect(DECLARATION_STEP).toBe(7);
    expect(TOTAL_STEPS).toBe(8);
    expect(STEP_TITLES).toHaveLength(8);
    expect(STEP_TITLES[7]).toBe('Declaration');
  });

  it('merged Readiness & Timeline into Finances rather than leaving a 3-field step', () => {
    const titles = ASSESSMENT_V2.map((s) => s.title);
    expect(titles).not.toContain('Readiness & Timeline');
    expect(titles).toContain('Finances & Readiness');
    // The three timeline keys survived the merge — this is the check that a
    // "tidy-up" cannot quietly drop a scored question.
    const merged = ASSESSMENT_V2.find((s) => s.title === 'Finances & Readiness')!;
    const keys = merged.questions.flatMap((q) => q.fields).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['q39_passport', 'q40_docs_ready', 'q41_apply_timeline']));
  });

  it('clamps a restored step into range', () => {
    expect(clampStep(99)).toBe(TOTAL_STEPS - 1);
    expect(clampStep(-4)).toBe(0);
    expect(clampStep('nonsense')).toBe(0);
    expect(clampStep(3)).toBe(3);
  });
});

describe('1. Next is gated on the current step', () => {
  it('refuses to advance while a required answer is empty, and says which', async () => {
    const user = userEvent.setup();
    render(<AssessmentV2Page />);
    await screen.findByRole('combobox', { name: 'What is your age range?' }).catch(() => null);

    await user.click(next());

    expect(stepHeading()).toBe('Step 1 of 8');                   // did not move
    // The message names the field, and sits WITH it rather than in one line at
    // the top of the form.
    expect(await screen.findByTestId('error-full_name')).toBeTruthy();
    expect(screen.getByTestId('error-email')).toBeTruthy();
  });

  it('advances once the step is complete', async () => {
    const user = userEvent.setup();
    render(<AssessmentV2Page />);

    await user.type(screen.getByLabelText('Full name'), 'Test Applicant');
    await user.type(screen.getByLabelText('Email address'), 'a@b.co');
    await user.type(screen.getByLabelText(/^Phone/), '215551234');
    // The country pickers are searchable buttons, not selects — pick through
    // the same search box a real applicant uses.
    for (const label of ['Country of residence', 'Nationality']) {
      await user.click(screen.getByLabelText(label));
      const search = screen.getByPlaceholderText('Search country or code');
      await user.type(search, 'New Zealand');
      await user.click(await screen.findByRole('button', { name: /New Zealand/ }));
    }

    await user.click(next());
    await waitFor(() => expect(stepHeading()).toBe('Step 2 of 8'));
  });
});

describe('2. Back never validates', () => {
  it('leaves an incomplete step going backwards', async () => {
    const user = userEvent.setup();
    // Start on step 3 with nothing filled in, via a restored draft.
    saveDraft({ q03_age: '22 - 29' }, 2);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 3 of 8'));

    // Forward is refused…
    await user.click(next());
    expect(stepHeading()).toBe('Step 3 of 8');

    // …backward is not, from the very same invalid state.
    await user.click(back());
    await waitFor(() => expect(stepHeading()).toBe('Step 2 of 8'));
  });

  it('clears the error messages when leaving a step', async () => {
    const user = userEvent.setup();
    saveDraft({ q03_age: '22 - 29' }, 1);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 2 of 8'));

    await user.click(next());
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));

    await user.click(back());
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });
});

describe('3. Submit re-validates every step', () => {
  it('catches a required field that only became visible because of a LATER answer', () => {
    // This is the case per-step gating cannot see. Marital status lives on step
    // 2; answering "Married" reveals partner questions on that same step. An
    // applicant who passed step 2 as "Single" and changed it afterwards — or a
    // draft assembled in that order — leaves step 2 incomplete behind them.
    const answers = completeAnswers();
    answers.q06_marital = 'Married';
    for (const k of ['q10_partner_edu', 'q11_partner_english', 'q09_partner_age', 'q07_marriage_years']) {
      delete answers[k];
    }

    const { errors, firstBadStep } = validateAll(answers);
    expect(firstBadStep).toBe(1);                       // 0-based → step 2
    expect(Object.keys(errors)).toContain('q10_partner_edu');
  });

  it('passes a genuinely complete answer set', () => {
    expect(validateAll(completeAnswers()).firstBadStep).toBeNull();
  });

  it('sends the applicant back to the offending step instead of failing silently', async () => {
    const user = userEvent.setup();
    const answers = completeAnswers();
    answers.q06_marital = 'Married';
    delete answers.q10_partner_edu;
    saveDraft(answers, DECLARATION_STEP);

    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 8 of 8'));

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /See my result/i }));

    // Not scored — returned to the step holding the missing answer.
    await waitFor(() => expect(stepHeading()).toBe('Step 2 of 8'));
    expect(await screen.findByTestId('error-q10_partner_edu')).toBeTruthy();
  });
});

describe('4. autosave carries the step', () => {
  it('resumes on step 4 after a refresh mid-step-4, not back at step 1', async () => {
    const user = userEvent.setup();
    saveDraft({ q03_age: '22 - 29' }, 3);

    const first = render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 4 of 8'));

    // Move on, so the persisted step is one the applicant actually reached.
    await user.click(back());
    await waitFor(() => expect(loadDraft()?.step).toBe(2));

    first.unmount();                // ← the refresh
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 3 of 8'));
  });

  it('writes the step immediately on navigation, beating the 500 ms debounce', async () => {
    const user = userEvent.setup();
    saveDraft({ q03_age: '22 - 29' }, 1);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 2 of 8'));

    await user.click(back());
    // No waitFor with a long timeout: if this needed the debounce to elapse,
    // a fast Next-then-refresh would lose the answer that caused it.
    expect(loadDraft()?.step).toBe(0);
  });

  it('discards a v1 draft, whose `step` meant something else', () => {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, answers: { q03_age: '22 - 29' }, step: 0 }));
    expect(loadDraft()).toBeNull();
  });
});

describe('the progress bar only lets you jump to steps you have reached', () => {
  it('renders reached steps as buttons and unreached ones as inert', async () => {
    saveDraft({ q03_age: '22 - 29' }, 2);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 3 of 8'));

    expect(screen.getByRole('button', { name: /Go to step 1:/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Go to step 3:/ })).toBeTruthy();
    // Step 4 has not been reached — no button exists to skip the gate with.
    expect(screen.queryByRole('button', { name: /Go to step 4:/ })).toBeNull();
    expect(screen.getByLabelText(/Step 4:.*not yet reached/)).toBeTruthy();
  });

  it('ticks a step only when it is actually complete, not merely reached', async () => {
    // Found by screenshotting the declaration step. Resuming a draft parked at
    // step 8 marks every earlier step "reached", and a reached-means-done tick
    // promised seven finished steps to someone who had answered one — then
    // bounced them backwards on submit.
    saveDraft({ q01_motivation: 'Very High' }, DECLARATION_STEP);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 8 of 8'));

    // Reachable, so still clickable — but not claimed as complete.
    const step2 = screen.getByRole('button', { name: /Go to step 2:/ });
    expect(within(step2).queryByText('2')).toBeTruthy();
    expect(step2.querySelector('svg')).toBeNull();          // no check icon
  });

  it('does tick a step once every answer on it is present', async () => {
    saveDraft(completeAnswers(), DECLARATION_STEP);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 8 of 8'));

    const step2 = screen.getByRole('button', { name: /Go to step 2:/ });
    expect(step2.querySelector('svg')).not.toBeNull();      // check icon present
  });

  it('jumps back to an earlier step when its dot is clicked', async () => {
    const user = userEvent.setup();
    saveDraft({ q03_age: '22 - 29' }, 4);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 5 of 8'));

    await user.click(screen.getByRole('button', { name: /Go to step 2:/ }));
    await waitFor(() => expect(stepHeading()).toBe('Step 2 of 8'));
    // Still reachable forward — going back must not lower the ceiling.
    expect(screen.getByRole('button', { name: /Go to step 5:/ })).toBeTruthy();
  });
});

describe('the form survives a study-fields endpoint that misbehaves', () => {
  // Found by opening the page in a browser with the backend down. The endpoint
  // answered with an error object, `fields` stopped being an array, and the
  // `fields.find(...)` in render threw — a white screen on a public form, with
  // no message and nothing in the UI to retry. Every test mocked this endpoint
  // into returning an array, so nothing caught it.
  it.each([
    ['an error object', { statusCode: 404, message: 'Not Found' }],
    ['null',            null],
    ['a bare string',   'upstream unavailable'],
  ])('still renders when study-fields returns %s', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/study-fields')) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));

    render(<AssessmentV2Page />);
    // The form is up rather than a blank error boundary.
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
    expect(stepHeading()).toBe('Step 1 of 8');
  });
});

describe('the declaration step', () => {
  it('keeps Submit disabled until the box is ticked', async () => {
    const user = userEvent.setup();
    saveDraft(completeAnswers(), DECLARATION_STEP);
    render(<AssessmentV2Page />);
    await waitFor(() => expect(stepHeading()).toBe('Step 8 of 8'));

    const submit = screen.getByRole('button', { name: /See my result/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('checkbox'));
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    await user.click(submit);
    await screen.findByText(/Your readiness/i);
  });
});
