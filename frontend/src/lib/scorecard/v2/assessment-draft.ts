// PR-PHASE33 — session-scoped autosave for the v2 assessment.
//
// DELIBERATE SCOPE: sessionStorage, not localStorage and not a database draft.
// The product decision is that abandoning the form and coming back later starts
// over; autosave exists ONLY to survive an accidental refresh or a browser
// crash inside the current session. sessionStorage is exactly that lifetime, so
// the "start over" behaviour is the platform's, not something we have to
// implement and keep correct.
//
// It also means /assessment stays anonymous-friendly: no draft table, no
// retention policy, and no half-finished answers about health or criminal
// history sitting in our database for a visitor who never submitted.

export const DRAFT_KEY = 'sv_assessment_v2_draft';

/**
 * Bump when the question set changes shape in a way that makes an old draft
 * wrong (a key renamed, an answer's option list narrowed). A draft whose
 * version does not match is discarded rather than migrated — a stale draft is
 * worth far less than a form in a state no code expects.
 */
export const DRAFT_VERSION = 1;

export interface AssessmentDraft {
  version: number;
  answers: Record<string, unknown>;
  /** Reserved for the multi-step UX; single-page form always writes 0. */
  step:    number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // Safari private mode and locked-down enterprise browsers throw on access.
    return null;
  }
}

/** Persist the in-progress answers. Never throws — autosave must not break the form. */
export function saveDraft(answers: Record<string, unknown>, step = 0, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    const draft: AssessmentDraft = { version: DRAFT_VERSION, answers, step };
    store.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota exceeded, or storage disabled mid-session. Losing autosave is
    // acceptable; losing the form is not.
  }
}

/**
 * Read back a draft for THIS session.
 *
 * Returns null for anything not obviously safe to restore: no draft, corrupt
 * JSON, a version mismatch, or an `answers` that is not a plain object. The
 * caller then simply starts from an empty form.
 */
export function loadDraft(store: Storage | null = storage()): AssessmentDraft | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const d = parsed as Partial<AssessmentDraft>;
    if (d.version !== DRAFT_VERSION) return null;
    if (typeof d.answers !== 'object' || d.answers === null || Array.isArray(d.answers)) return null;
    return {
      version: DRAFT_VERSION,
      answers: d.answers as Record<string, unknown>,
      step:    typeof d.step === 'number' && Number.isFinite(d.step) ? d.step : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Drop the draft.
 *
 * MUST be called after a successful submit. Without it the applicant stays in
 * the same tab, hits "Start over", and is handed back the answers they just
 * submitted — which reads as the form having failed to reset.
 */
export function clearDraft(store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to do — the draft simply outlives the tab, which is bounded anyway */
  }
}

/** True when there is anything worth saving (avoids writing `{}` on mount). */
export function hasAnswers(answers: Record<string, unknown>): boolean {
  return Object.values(answers).some(
    (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  );
}
