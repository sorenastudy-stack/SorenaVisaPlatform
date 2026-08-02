// PR-ADMISSION-CVDATA (Step 2a) — pure validation for an employment-history entry, mirroring
// the education year-validation (admission.service validateEducationYears). No I/O; the year
// bounds take an injected `currentYear` so the golden battery is deterministic across years.
// Draft-friendly: null years are allowed (the client may not know exact dates yet).

export const EMP_MIN_YEAR = 1950;

export function validateEmploymentYears(
  startYear: number | null | undefined,
  endYear: number | null | undefined,
  isCurrent: boolean,
  currentYear: number = new Date().getFullYear(),
): string | null {
  const maxYear = currentYear; // employment can't be in the future
  const inRange = (n: number) => Number.isInteger(n) && n >= EMP_MIN_YEAR && n <= maxYear;

  if (startYear != null && !inRange(startYear)) return 'Please enter a valid 4-digit year.';
  if (endYear != null && !inRange(endYear)) return 'Please enter a valid 4-digit year.';
  // A current role has no end year.
  if (isCurrent && endYear != null) return 'A current role cannot have an end year — leave it blank.';
  // Only meaningful for a finished role with both years.
  if (!isCurrent && startYear != null && endYear != null && startYear > endYear) {
    return 'Start year cannot be after end year.';
  }
  return null;
}
