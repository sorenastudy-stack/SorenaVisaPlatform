import {
  validateSubmissionInput,
  summariseChoiceSubmissions,
  isResolvedOutcome,
  type SubmissionInput,
  type AttemptRow,
} from './submission.logic';

const TODAY = '2026-08-03';
const valid: SubmissionInput = { submittedAt: '2026-08-01', method: 'PORTAL', portalName: 'Uni apply', referenceNo: 'APP-1' };

describe('validateSubmissionInput', () => {
  it('accepts a well-formed attempt', () => {
    expect(validateSubmissionInput(valid, TODAY)).toEqual([]);
  });

  it('requires a valid submission date', () => {
    expect(validateSubmissionInput({ ...valid, submittedAt: '' }, TODAY)).toContain('A valid submission date is required.');
    expect(validateSubmissionInput({ ...valid, submittedAt: '2026-13-40' }, TODAY)).toContain('A valid submission date is required.');
    expect(validateSubmissionInput({ ...valid, submittedAt: 'Aug 1' }, TODAY)).toContain('A valid submission date is required.');
  });

  it('rejects a future submission date', () => {
    expect(validateSubmissionInput({ ...valid, submittedAt: '2026-08-04' }, TODAY)).toContain('The submission date cannot be in the future.');
  });

  it('accepts a submission dated exactly today', () => {
    expect(validateSubmissionInput({ ...valid, submittedAt: TODAY }, TODAY)).toEqual([]);
  });

  it('rejects an invalid method', () => {
    expect(validateSubmissionInput({ ...valid, method: 'CARRIER_PIGEON' }, TODAY)).toContain('Choose a valid submission method.');
  });

  it('rejects an invalid outcome but allows an empty/absent one', () => {
    expect(validateSubmissionInput({ ...valid, outcome: 'MAYBE' }, TODAY)).toContain('Choose a valid outcome.');
    expect(validateSubmissionInput({ ...valid, outcome: '' }, TODAY)).toEqual([]);
    expect(validateSubmissionInput({ ...valid, outcome: 'OFFER' }, TODAY)).toEqual([]);
  });

  it('rejects a response date before the submission date', () => {
    expect(validateSubmissionInput({ ...valid, responseReceivedAt: '2026-07-31' }, TODAY))
      .toContain('The response date cannot be before the submission date.');
  });

  it('rejects a future response date', () => {
    expect(validateSubmissionInput({ ...valid, responseReceivedAt: '2026-08-04' }, TODAY))
      .toContain('The response date cannot be in the future.');
  });

  it('accepts a response date on/after the submission date', () => {
    expect(validateSubmissionInput({ ...valid, responseReceivedAt: '2026-08-02', outcome: 'OFFER' }, TODAY)).toEqual([]);
  });
});

describe('summariseChoiceSubmissions — append-only, latest attempt wins', () => {
  it('reports "never submitted" for no records', () => {
    expect(summariseChoiceSubmissions([])).toEqual({ attemptCount: 0, latestId: null, latestOutcome: null });
  });

  it('the latest attempt by submittedAt drives the current outcome, regardless of input order', () => {
    const rows: AttemptRow[] = [
      { id: 'a', submittedAt: '2026-08-01', createdAt: '2026-08-01T10:00:00Z', outcome: 'PENDING' },
      { id: 'c', submittedAt: '2026-08-10', createdAt: '2026-08-10T09:00:00Z', outcome: 'OFFER' },
      { id: 'b', submittedAt: '2026-08-05', createdAt: '2026-08-05T09:00:00Z', outcome: 'ACKNOWLEDGED' },
    ];
    const s = summariseChoiceSubmissions(rows);
    expect(s.attemptCount).toBe(3);
    expect(s.latestId).toBe('c');
    expect(s.latestOutcome).toBe('OFFER');
  });

  it('tiebreaks two same-day attempts by the one created last', () => {
    const rows: AttemptRow[] = [
      { id: 'first', submittedAt: '2026-08-05', createdAt: '2026-08-05T09:00:00Z', outcome: 'PENDING' },
      { id: 'second', submittedAt: '2026-08-05', createdAt: '2026-08-05T14:00:00Z', outcome: 'DECLINED' },
    ];
    expect(summariseChoiceSubmissions(rows).latestId).toBe('second');
    expect(summariseChoiceSubmissions(rows).latestOutcome).toBe('DECLINED');
  });

  it('does not mutate the input array', () => {
    const rows: AttemptRow[] = [
      { id: 'a', submittedAt: '2026-08-01', createdAt: '2026-08-01T10:00:00Z', outcome: 'PENDING' },
      { id: 'b', submittedAt: '2026-08-05', createdAt: '2026-08-05T09:00:00Z', outcome: 'OFFER' },
    ];
    summariseChoiceSubmissions(rows);
    expect(rows[0].id).toBe('a'); // original order preserved
  });
});

describe('isResolvedOutcome', () => {
  it('treats OFFER/DECLINED/WITHDRAWN as resolved, PENDING/ACKNOWLEDGED as open', () => {
    expect(['OFFER', 'DECLINED', 'WITHDRAWN'].every((o) => isResolvedOutcome(o as any))).toBe(true);
    expect(['PENDING', 'ACKNOWLEDGED'].some((o) => isResolvedOutcome(o as any))).toBe(false);
  });
});
