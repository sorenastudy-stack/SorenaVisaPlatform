// PR-DATE-DISPLAY / PR-I18N-1 — single shared date-formatting helper.
//
// GOAL: every date the user sees is DAY-FIRST — English "8 Jul 2026" (en-NZ), and
// in Persian the SAME (Gregorian) calendar rendered with Persian month names +
// Persian digits — "۸ ژوئیه ۲۰۲۶" — via the `fa-IR-u-ca-gregory` locale. We keep
// the Gregorian calendar deliberately (locked decision): clients cross-reference
// these against their passport / INZ / visa documents, which are all Gregorian.
// DISPLAY ONLY; stored/POSTed values stay ISO and never pass through here.
//
// Two rules baked in:
//  • A pure calendar date ("YYYY-MM-DD", no time) is anchored to UTC so it never
//    shifts a day across the NZ/Iran timezone boundary.
//  • A full timestamp ("...T..Z") is shown in the runtime-local timezone.

const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type DateValue = string | number | Date | null | undefined;
export type DateLocale = 'en' | 'fa';

// Persian keeps the Gregorian calendar (u-ca-gregory) — only month names +
// digits localise. English stays en-NZ (day-first).
const intlLocale = (locale: DateLocale): string =>
  locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-NZ';

function toDate(value: DateValue): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Day-first calendar date — "8 Jul 2026" (en) / "۸ ژوئیه ۲۰۲۶" (fa). Returns ''
 * for empty/invalid input (or the original string if it was unparseable).
 */
export function formatDate(value: DateValue, locale: DateLocale = 'en'): string {
  if (value == null || value === '') return '';

  // Pure YYYY-MM-DD → anchor UTC so date-only values never drift a day.
  if (typeof value === 'string' && YMD_ONLY.test(value.trim())) {
    const d = new Date(`${value.trim()}T00:00:00Z`);
    return new Intl.DateTimeFormat(intlLocale(locale), {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(d);
  }

  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
}

/**
 * Day-first date + time — "8 Jul 2026, 1:30 pm". Pass { weekday: 'long' } for a
 * weekday prefix, a `timeZone` to pin the zone (defaults to runtime-local), and
 * `locale: 'fa'` for Persian month names + digits (Gregorian).
 */
export function formatDateTime(
  value: DateValue,
  opts: { weekday?: 'long' | 'short'; timeZone?: string; locale?: DateLocale } = {},
): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? (value ?? '') : '';
  return new Intl.DateTimeFormat(intlLocale(opts.locale ?? 'en'), {
    ...(opts.weekday ? { weekday: opts.weekday } : {}),
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(d);
}

/**
 * Locale-aware relative time — "5 minutes ago" (en) / "۵ دقیقه پیش" (fa, Persian
 * digits). Replaces the per-page English-only `timeAgo`/`formatWhen`. Returns ''
 * for empty/invalid input.
 */
export function relativeTime(value: DateValue, locale: DateLocale = 'en'): string {
  const d = toDate(value);
  if (!d) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa' : 'en', { numeric: 'auto' });
  if (min < 1) return locale === 'fa' ? 'همین حالا' : 'just now';
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, 'hour');
  const day = Math.round(hr / 24);
  if (day < 30) return rtf.format(-day, 'day');
  return rtf.format(-Math.round(day / 30), 'month');
}
