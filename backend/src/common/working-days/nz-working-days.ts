// Canonical NZ working-day arithmetic — the ONE source of truth for "skip weekends + NZ national
// public holidays". Used by PR-SLA (case-stage deadlines) and PR-ADMISSION-FOLLOWUP (the 5-working-
// day institution follow-up), so the holiday list never drifts between two copies.
//
// National only — provincial anniversary days are deliberately excluded (a case isn't tied to one
// region). Static list, low upkeep: extend every few years. Moving feasts (Easter, Matariki) and
// Mondayised weekend holidays are pre-resolved to their observed weekday (ISO yyyy-mm-dd, UTC).
export const NZ_PUBLIC_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', '2026-01-02', '2026-02-06', '2026-04-03', '2026-04-06',
  '2026-04-27', '2026-06-01', '2026-07-10', '2026-10-26', '2026-12-25', '2026-12-28',
  // 2027
  '2027-01-01', '2027-01-04', '2027-02-08', '2027-03-26', '2027-03-29',
  '2027-04-26', '2027-06-07', '2027-06-25', '2027-10-25', '2027-12-27', '2027-12-28',
  // 2028
  '2028-01-03', '2028-01-04', '2028-02-07', '2028-04-14', '2028-04-17',
  '2028-04-25', '2028-06-05', '2028-07-14', '2028-10-23', '2028-12-25', '2028-12-26',
  // 2029
  '2029-01-01', '2029-01-02', '2029-02-06', '2029-03-30', '2029-04-02',
  '2029-04-25', '2029-06-04', '2029-07-06', '2029-10-22', '2029-12-25', '2029-12-26',
  // 2030
  '2030-01-01', '2030-01-02', '2030-02-06', '2030-04-19', '2030-04-22',
  '2030-04-25', '2030-06-03', '2030-06-21', '2030-10-28', '2030-12-25', '2030-12-26',
]);

// Is this date a working day (not a weekend, not an NZ national public holiday)? Compared in UTC.
export function isNzWorkingDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !NZ_PUBLIC_HOLIDAYS.has(d.toISOString().slice(0, 10));
}

// Add N working days to `start`, skipping Saturdays/Sundays AND NZ national public holidays.
export function addWorkingDays(start: Date, n: number): Date {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isNzWorkingDay(d)) added++;
  }
  return d;
}
