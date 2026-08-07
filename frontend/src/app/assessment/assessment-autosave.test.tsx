/**
 * PR-PHASE33 — session-scoped autosave.
 *
 * The requirement has two halves that pull in opposite directions, so both are
 * asserted here:
 *   1. an accidental refresh WITHIN a session must not lose the answers, and
 *   2. abandoning the form and coming back later must start from the beginning.
 *
 * (2) is what makes this sessionStorage rather than localStorage or a database
 * draft. It is tested by asserting the draft lives in sessionStorage and
 * nowhere else — the browser then enforces the "later" part for free, which is
 * the entire reason that store was chosen.
 *
 * The refresh is simulated by unmounting and re-rendering the page, which is
 * what a reload does to React state while leaving sessionStorage intact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssessmentV2Page from './page';
import { ASSESSMENT_V2, type V2FieldDef } from '@/lib/scorecard/v2/assessment-v2';
import { DRAFT_KEY, DRAFT_VERSION, loadDraft, saveDraft, clearDraft } from '@/lib/scorecard/v2/assessment-draft';

const AGE_LABEL = 'What is your age range?';

const STUDY_FIELDS = [
  { id: 'cmsf1a2b3c4d5e6f7g8h9i0j', key: 'it_computer_science', nameEn: 'Information Technology & Computer Science', nameFa: '', category: { key: 'stem', nameEn: 'STEM', alwaysSelectable: false } },
  { id: 'cmsf2b3c4d5e6f7g8h9i0j1k', key: 'engineering',         nameEn: 'Engineering',                              nameFa: '', category: { key: 'stem', nameEn: 'STEM', alwaysSelectable: false } },
];

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
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

/**
 * Build an answer set that satisfies the page's own required-field validation,
 * derived from ASSESSMENT_V2 rather than hard-coded — so a new required
 * question does not quietly turn the submit test into a no-op.
 */
function completeAnswers(): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  const fill = (f: V2FieldDef) => {
    switch (f.type) {
      case 'select':          a[f.key] = f.options?.[0] ?? 'x'; break;
      case 'studyfield':      a[f.key] = STUDY_FIELDS[0].id; break;
      case 'studyfield-multi':a[f.key] = [STUDY_FIELDS[0].id]; break;
      case 'boolean':         a[f.key] = true; break;
      case 'number':          a[f.key] = 1; break;
      case 'email':           a[f.key] = 'applicant@example.com'; break;
      case 'phone':           a[f.key] = '+64215551234'; break;
      case 'country':         a[f.key] = 'IR'; break;
      default:                a[f.key] = 'Test'; break;
    }
  };
  // Two passes: conditional fields become visible once their trigger is set.
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

async function selectAge(user: ReturnType<typeof userEvent.setup>, option = '22 - 29') {
  const select = await screen.findByRole('combobox', { name: AGE_LABEL });
  await user.selectOptions(select, within(select).getByRole('option', { name: option }));
  return select as HTMLSelectElement;
}

describe('a refresh inside the session keeps the answers', () => {
  it('restores what was typed after the page is remounted', async () => {
    const user = userEvent.setup();
    const first = render(<AssessmentV2Page />);
    await selectAge(user);

    // The 500 ms debounce means the draft is not written instantly.
    await waitFor(() => expect(loadDraft()?.answers.q03_age).toBe('22 - 29'), { timeout: 2000 });

    first.unmount();               // ← the refresh: React state is gone…
    render(<AssessmentV2Page />);  // …sessionStorage is not.

    const restored = await screen.findByRole('combobox', { name: AGE_LABEL });
    await waitFor(() => expect((restored as HTMLSelectElement).value).toBe('22 - 29'));
  });

  it('writes to sessionStorage and NOT localStorage — this is what makes return visits start over', () => {
    saveDraft({ q03_age: '22 - 29' });
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toContain('22 - 29');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('a successful submit clears the draft', () => {
  it('removes the key once the results screen is reached', async () => {
    const user = userEvent.setup();
    // Seed a complete draft, which the page restores — this is also a second
    // proof that restore works, through the real submit path.
    saveDraft(completeAnswers());
    expect(window.sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();

    render(<AssessmentV2Page />);
    await screen.findByRole('combobox', { name: AGE_LABEL });

    await user.click(await screen.findByRole('button', { name: /See my result/i }));

    // Results screen reached…
    await screen.findByText(/Your readiness/i);
    // …and the draft is gone, so "Start over" cannot resurrect what was sent.
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('a draft is only restored when it is safe to', () => {
  it('discards a draft written by a different form version', () => {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: DRAFT_VERSION + 1, answers: { q03_age: '22 - 29' }, step: 0 }));
    expect(loadDraft()).toBeNull();
  });

  it('discards corrupt or malformed drafts instead of throwing', () => {
    window.sessionStorage.setItem(DRAFT_KEY, '{not json');
    expect(loadDraft()).toBeNull();

    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: DRAFT_VERSION, answers: ['a'], step: 0 }));
    expect(loadDraft()).toBeNull();
  });

  it('survives storage being unavailable (Safari private mode)', () => {
    const throwing = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(() => saveDraft({ q03_age: '22 - 29' }, 0, throwing)).not.toThrow();
    expect(loadDraft(throwing)).toBeNull();
    expect(() => clearDraft(throwing)).not.toThrow();
  });

  it('does not write an empty draft on mount', async () => {
    render(<AssessmentV2Page />);
    await screen.findByRole('combobox', { name: AGE_LABEL });
    await new Promise((r) => setTimeout(r, 700));
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
