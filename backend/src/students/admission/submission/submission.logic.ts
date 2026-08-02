// PR-ADMISSION-SUBMIT (step 4) — pure Submission-Log logic. NO I/O. Two things worth freezing
// before wiring: input validation for a logged attempt, and the append-only "a choice's current
// status is its LATEST attempt" derivation. Golden-frozen.

export type SubmissionMethod = 'PORTAL' | 'EMAIL' | 'AGENT_PORTAL' | 'OTHER';
export type SubmissionOutcome = 'PENDING' | 'ACKNOWLEDGED' | 'OFFER' | 'DECLINED' | 'WITHDRAWN';

export const SUBMISSION_METHODS: SubmissionMethod[] = ['PORTAL', 'EMAIL', 'AGENT_PORTAL', 'OTHER'];
export const SUBMISSION_OUTCOMES: SubmissionOutcome[] = ['PENDING', 'ACKNOWLEDGED', 'OFFER', 'DECLINED', 'WITHDRAWN'];

export const SUBMISSION_METHOD_LABEL: Record<SubmissionMethod, string> = {
  PORTAL: 'Institution portal',
  EMAIL: 'Email',
  AGENT_PORTAL: 'Agent portal',
  OTHER: 'Other',
};
export const SUBMISSION_OUTCOME_LABEL: Record<SubmissionOutcome, string> = {
  PENDING: 'Pending',
  ACKNOWLEDGED: 'Acknowledged',
  OFFER: 'Offer received',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

// A response outcome that no longer awaits the institution (used only for UI hinting).
export const isResolvedOutcome = (o: SubmissionOutcome): boolean => o === 'OFFER' || o === 'DECLINED' || o === 'WITHDRAWN';

// ── input validation ─────────────────────────────────────────────────────────

export interface SubmissionInput {
  submittedAt: string; // yyyy-mm-dd
  method: string;
  portalName?: string | null;
  referenceNo?: string | null;
  outcome?: string | null;
  responseReceivedAt?: string | null; // yyyy-mm-dd
  responseNotes?: string | null;
}

// A yyyy-mm-dd string that is a real calendar date. Lexicographic compare is valid for this format.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validate a logged attempt against `today` (yyyy-mm-dd, supplied by the caller so this stays pure).
// Returns a deterministic, ordered errors array ([] = valid).
export function validateSubmissionInput(input: SubmissionInput, today: string): string[] {
  const errors: string[] = [];

  if (!input.submittedAt || !isValidDateStr(input.submittedAt)) {
    errors.push('A valid submission date is required.');
  } else if (input.submittedAt > today) {
    errors.push('The submission date cannot be in the future.');
  }

  if (!SUBMISSION_METHODS.includes(input.method as SubmissionMethod)) {
    errors.push('Choose a valid submission method.');
  }

  if (input.outcome != null && input.outcome !== '' && !SUBMISSION_OUTCOMES.includes(input.outcome as SubmissionOutcome)) {
    errors.push('Choose a valid outcome.');
  }

  if (input.responseReceivedAt != null && input.responseReceivedAt !== '') {
    if (!isValidDateStr(input.responseReceivedAt)) {
      errors.push('The response date is not a valid date.');
    } else {
      if (input.responseReceivedAt > today) errors.push('The response date cannot be in the future.');
      if (isValidDateStr(input.submittedAt) && input.responseReceivedAt < input.submittedAt) {
        errors.push('The response date cannot be before the submission date.');
      }
    }
  }

  return errors;
}

// ── choice-level derivation (append-only: latest attempt wins) ────────────────

export interface AttemptRow {
  id: string;
  submittedAt: string; // yyyy-mm-dd (or ISO — compared lexicographically)
  createdAt: string; // ISO timestamp — tiebreak for same-day attempts
  outcome: SubmissionOutcome;
}

export interface ChoiceSubmissionSummary {
  attemptCount: number;
  latestId: string | null;
  latestOutcome: SubmissionOutcome | null; // null = never submitted
}

// The current status of a choice is its LATEST attempt: newest submittedAt, tiebroken by newest
// createdAt (so two attempts logged for the same day resolve to the one entered last). Records may
// arrive in any order; this does not mutate the input.
export function summariseChoiceSubmissions(records: AttemptRow[]): ChoiceSubmissionSummary {
  if (records.length === 0) return { attemptCount: 0, latestId: null, latestOutcome: null };
  const latest = [...records].sort((a, b) => {
    if (a.submittedAt !== b.submittedAt) return a.submittedAt < b.submittedAt ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  })[0];
  return { attemptCount: records.length, latestId: latest.id, latestOutcome: latest.outcome };
}
