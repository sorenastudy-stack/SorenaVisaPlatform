import {
  followUpDueDate,
  isFollowUpDue,
  planFollowUpSweep,
  followUpTitle,
  FOLLOW_UP_WORKING_DAYS,
  type ChoiceSweepState,
} from './follow-up.logic';

const at = (d: string) => new Date(`${d}T09:00:00Z`);

describe('followUpDueDate — 5 working days, NZ holidays skipped', () => {
  it('adds 5 working days across a plain week (Mon → next Mon)', () => {
    // 2026-08-03 is a Monday, no NZ holiday in the window. +5 wd = Tue..Fri (4) then Mon 10th (5).
    expect(followUpDueDate('2026-08-03')).toBe('2026-08-10');
  });

  it('skips weekends when the submission is late in the week', () => {
    // Fri 2026-08-07 → Mon,Tue,Wed,Thu,Fri = 2026-08-14 (skips two weekends worth of Sat/Sun).
    expect(followUpDueDate('2026-08-07')).toBe('2026-08-14');
  });

  it('skips an NZ public holiday inside the window (Matariki, Fri 2026-07-10)', () => {
    // Mon 2026-07-06 → Tue7,Wed8,Thu9 (3), Fri10 is Matariki (skip), Mon13 (4), Tue14 (5).
    expect(followUpDueDate('2026-07-06')).toBe('2026-07-14');
  });
});

describe('isFollowUpDue', () => {
  it('is not due before the due date, is due on and after it', () => {
    expect(isFollowUpDue('2026-08-03', at('2026-08-09'))).toBe(false); // day before due
    expect(isFollowUpDue('2026-08-03', at('2026-08-10'))).toBe(true); // exactly due
    expect(isFollowUpDue('2026-08-03', at('2026-08-12'))).toBe(true); // past due
  });
});

describe('followUpTitle', () => {
  it('names the programme, provider, and submission date', () => {
    const t = followUpTitle('Master of IT', 'Nowhere Uni', '2026-08-03');
    expect(t).toContain('Master of IT');
    expect(t).toContain('Nowhere Uni');
    expect(t).toContain('2026-08-03');
    expect(t).toContain(`${FOLLOW_UP_WORKING_DAYS} working days`);
  });
});

describe('planFollowUpSweep — idempotent create + self-healing resolve', () => {
  const NOW = at('2026-08-20'); // well past due for early-August submissions

  it('creates a task for a due, still-PENDING latest attempt with no open task', () => {
    const choices: ChoiceSweepState[] = [
      { choiceId: 'c1', latest: { recordId: 'r1', submittedAt: '2026-08-03', outcome: 'PENDING' }, openTaskRecordIds: [] },
    ];
    const plan = planFollowUpSweep(choices, NOW);
    expect(plan.toCreate).toEqual([{ choiceId: 'c1', recordId: 'r1' }]);
    expect(plan.toResolve).toEqual([]);
  });

  it('does not double-create when an open task already exists', () => {
    const choices: ChoiceSweepState[] = [
      { choiceId: 'c1', latest: { recordId: 'r1', submittedAt: '2026-08-03', outcome: 'PENDING' }, openTaskRecordIds: ['r1'] },
    ];
    const plan = planFollowUpSweep(choices, NOW);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toResolve).toEqual([]); // the open task matches the live PENDING record — keep it
  });

  it('does not create before the due date', () => {
    const choices: ChoiceSweepState[] = [
      { choiceId: 'c1', latest: { recordId: 'r1', submittedAt: '2026-08-18', outcome: 'PENDING' }, openTaskRecordIds: [] },
    ];
    expect(planFollowUpSweep(choices, NOW).toCreate).toEqual([]);
  });

  it('resolves an open task once the institution has responded (latest ≠ PENDING)', () => {
    const choices: ChoiceSweepState[] = [
      { choiceId: 'c1', latest: { recordId: 'r1', submittedAt: '2026-08-03', outcome: 'OFFER' }, openTaskRecordIds: ['r1'] },
    ];
    const plan = planFollowUpSweep(choices, NOW);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toResolve).toEqual(['r1']);
  });

  it('resolves a superseded attempt and creates for the new latest one', () => {
    // r1 had a task; the client resubmitted (r2, newer + due) → close r1, open for r2.
    const choices: ChoiceSweepState[] = [
      { choiceId: 'c1', latest: { recordId: 'r2', submittedAt: '2026-08-04', outcome: 'PENDING' }, openTaskRecordIds: ['r1'] },
    ];
    const plan = planFollowUpSweep(choices, NOW);
    expect(plan.toCreate).toEqual([{ choiceId: 'c1', recordId: 'r2' }]);
    expect(plan.toResolve).toEqual(['r1']);
  });

  it('does nothing for a choice with no submissions', () => {
    const plan = planFollowUpSweep([{ choiceId: 'c1', latest: null, openTaskRecordIds: [] }], NOW);
    expect(plan).toEqual({ toCreate: [], toResolve: [] });
  });
});
