// PR-INTAKE-1 (Slice 3) — pure, deterministic copy for the submit-time intake
// reassignment. Student ticket notices + Admission-Officer task titles. Frozen, so
// the human-facing messages a real client receives are reviewed + stable. Tone
// matches the calm, honest microcopy from PR-ADMISSION-SHARED (no overpromising).

export interface TermIntake { month: number; year: number }

// "February 2027" — English (the student ticket + task titles are English).
export function intakeTermLabel(i: TermIntake): string {
  return new Intl.DateTimeFormat('en-NZ', { month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(i.year, i.month - 1, 1)));
}

// Student notice — auto-reassigned to the next available term.
export function intakeReassignedNotice(newTerm: TermIntake, liaLeadMonths: number): string {
  return `Because your completed application arrived less than ${liaLeadMonths} months before your chosen intake — and our legal team needs that time to prepare and submit your visa application — we've moved your admission to the next available term: ${intakeTermLabel(newTerm)}. Your advisor will confirm the details with you.`;
}

// Student notice — edge case: no valid next term found. Calm, honest, does NOT
// promise a resolution the system doesn't have.
export function intakeManualReviewNotice(): string {
  return `Your completed application arrived close to your chosen intake's start. Because there isn't a later term available within our planning window, your advisor is reviewing your options and will be in touch shortly.`;
}

// Admission-Officer task titles.
export function reassignTaskTitle(studentName: string | null, newTerm: TermIntake, programmeLabel: string): string {
  const who = studentName?.trim() || 'this student';
  return `Re-apply ${who} for ${intakeTermLabel(newTerm)} — ${programmeLabel}`;
}

export function manualReviewTaskTitle(studentName: string | null, programmeLabel: string): string {
  const who = studentName?.trim() || 'this student';
  return `No valid next intake found for ${who} — ${programmeLabel}. Manual review needed.`;
}
