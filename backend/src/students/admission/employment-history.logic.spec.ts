// PR-ADMISSION-CVDATA (Step 2a) — golden battery for employment year validation. Frozen
// before wiring. Deterministic via an injected currentYear (2026).
import { validateEmploymentYears } from './employment-history.logic';

const NOW = 2026;
const v = (s: number | null, e: number | null, cur: boolean) => validateEmploymentYears(s, e, cur, NOW);

describe('validateEmploymentYears', () => {
  it('accepts a valid finished role (start ≤ end, in range)', () => {
    expect(v(2018, 2022, false)).toBeNull();
  });
  it('accepts a current role with no end year', () => {
    expect(v(2022, null, true)).toBeNull();
  });
  it('accepts null years (draft — client may not know yet)', () => {
    expect(v(null, null, false)).toBeNull();
    expect(v(null, null, true)).toBeNull();
  });
  it('rejects a current role that also has an end year', () => {
    expect(v(2022, 2024, true)).toBe('A current role cannot have an end year — leave it blank.');
  });
  it('rejects start year after end year (finished role)', () => {
    expect(v(2023, 2020, false)).toBe('Start year cannot be after end year.');
  });
  it('rejects an out-of-range / future year', () => {
    expect(v(1900, null, false)).toBe('Please enter a valid 4-digit year.');
    expect(v(2030, null, false)).toBe('Please enter a valid 4-digit year.'); // future (> 2026)
    expect(v(2018, 2031, false)).toBe('Please enter a valid 4-digit year.');
  });
  it('does not flag start>end for a current role (end is blank by rule)', () => {
    expect(v(2024, null, true)).toBeNull();
  });
});
