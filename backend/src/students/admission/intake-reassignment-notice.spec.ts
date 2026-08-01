// PR-INTAKE-1 (Slice 3) — GOLDEN freeze for the reassignment copy. These strings
// reach a real client at a sensitive moment (their term changed), so they're pinned.
import {
  intakeTermLabel, intakeReassignedNotice, intakeManualReviewNotice,
  reassignTaskTitle, manualReviewTaskTitle,
} from './intake-reassignment-notice';

describe('GOLDEN — intake reassignment copy', () => {
  it('term label', () => {
    expect(intakeTermLabel({ month: 2, year: 2027 })).toBe('February 2027');
  });

  it('reassigned notice (config-accurate month count, next term named)', () => {
    expect(intakeReassignedNotice({ month: 6, year: 2027 }, 4)).toBe(
      "Because your completed application arrived less than 4 months before your chosen intake — and our legal team needs that time to prepare and submit your visa application — we've moved your admission to the next available term: June 2027. Your advisor will confirm the details with you.",
    );
  });

  it('manual-review notice (calm, no false promise)', () => {
    expect(intakeManualReviewNotice()).toBe(
      "Your completed application arrived close to your chosen intake's start. Because there isn't a later term available within our planning window, your advisor is reviewing your options and will be in touch shortly.",
    );
  });

  it('task titles (reassign + manual review; graceful name fallback)', () => {
    expect(reassignTaskTitle('Maryam', { month: 2, year: 2027 }, 'Aotearoa University — Bachelor of IT'))
      .toBe('Re-apply Maryam for February 2027 — Aotearoa University — Bachelor of IT');
    expect(manualReviewTaskTitle('Maryam', 'Aotearoa University — Bachelor of IT'))
      .toBe('No valid next intake found for Maryam — Aotearoa University — Bachelor of IT. Manual review needed.');
    expect(manualReviewTaskTitle(null, 'X')).toBe('No valid next intake found for this student — X. Manual review needed.');
  });
});
