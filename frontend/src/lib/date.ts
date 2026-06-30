// PR-DATE-DISPLAY — single shared date-formatting helper for the whole app.
//
// GOAL: every date the user sees is DAY-FIRST New Zealand style — "8 Jul 2026"
// (never US "Jul 8" / "7/8/2026"). This is DISPLAY ONLY; stored and POSTed
// values stay ISO YYYY-MM-DD and never pass through here on the way out.
//
// Two rules baked in:
//  • A pure calendar date ("YYYY-MM-DD", no time) is anchored to UTC so it
//    never shifts a day across the NZ/Iran timezone boundary.
//  • A full timestamp ("...T..Z") is shown in the runtime-local timezone,
//    matching the previous behaviour — we only change the FORMAT, not the tz.

const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type DateValue = string | number | Date | null | undefined;

function toDate(value: DateValue): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Day-first calendar date, e.g. "8 Jul 2026". Returns '' for empty/invalid
 * input (or the original string if it was an unparseable non-empty string).
 */
export function formatDate(value: DateValue): string {
  if (value == null || value === '') return '';

  // Pure YYYY-MM-DD → anchor UTC so date-only values never drift a day.
  if (typeof value === 'string' && YMD_ONLY.test(value.trim())) {
    const d = new Date(`${value.trim()}T00:00:00Z`);
    return new Intl.DateTimeFormat('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(d);
  }

  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  // Timestamp → runtime-local tz (unchanged behaviour), day-first format.
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
}

/**
 * Day-first date + time, e.g. "8 Jul 2026, 1:30 pm". Pass { weekday: 'long' }
 * for "Wednesday, 8 Jul 2026, 1:30 pm", or a `timeZone` to pin the zone
 * (defaults to runtime-local, matching prior behaviour).
 */
export function formatDateTime(
  value: DateValue,
  opts: { weekday?: 'long' | 'short'; timeZone?: string } = {},
): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? (value ?? '') : '';
  return new Intl.DateTimeFormat('en-NZ', {
    ...(opts.weekday ? { weekday: opts.weekday } : {}),
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(d);
}
