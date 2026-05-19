// Centralised step-visibility logic for the admission form.
// Steps 5 (Parent/Guardian) and 6 (Accommodation) only render for applicants
// under 18. The decision is "age today, whole years" — not age at course start.
//
// Fail-safe: when DOB is unknown, all steps are shown. Never hide steps based
// on missing data — under-disclosure is worse than over-disclosure here.

export const STUDENT_STEPS = [1, 2, 3, 4, 5, 6, 8];
export const AGENT_STEPS   = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Returns whole-years age as of today for a 'YYYY-MM-DD' (or ISO) input.
 * Returns null when the input is empty/invalid or implies an absurd age
 * (which we treat as "unknown").
 */
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  // Accept either 'YYYY-MM-DD' or a full ISO timestamp.
  const dobStr = dateOfBirth.slice(0, 10);
  const d = new Date(dobStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) {
    age--;
  }
  if (age < 0 || age > 150) return null;
  return age;
}

/**
 * True when DOB is missing/invalid (fail-safe) OR resolves to age < 18.
 * False only when we know with confidence the applicant is 18+.
 */
export function isUnder18(dateOfBirth: string | null | undefined): boolean {
  const age = calculateAge(dateOfBirth);
  if (age === null) return true;
  return age < 18;
}

/**
 * The list of steps visible to the user. Drives: sidebar render, Next/Back
 * arithmetic, and which step counts as "last" (Submit instead of Next).
 *
 * Under 18 (or DOB unknown) → all role-appropriate steps.
 * 18+                       → Steps 5 and 6 are dropped.
 */
export function getVisibleSteps(
  role: string,
  dateOfBirth: string | null | undefined,
): number[] {
  const base = role === 'AGENT' ? AGENT_STEPS : STUDENT_STEPS;
  if (isUnder18(dateOfBirth)) return [...base];
  return base.filter((s) => s !== 5 && s !== 6);
}
