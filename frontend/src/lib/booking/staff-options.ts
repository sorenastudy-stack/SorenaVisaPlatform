// PR-BOOKING-ADMIN-A — shared option lists for the adviser panel.
// Kept in one place so the list + edit views stay in sync and new
// languages/timezones are easy to add later.

export interface LangOption { code: string; label: string; }

// ISO 639-1 codes. Extend this list to add more languages.
export const LANGUAGES: LangOption[] = [
  { code: 'en', label: 'English' },
  { code: 'fa', label: 'Persian / Farsi' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ur', label: 'Urdu' },
];

export function langLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export interface SessionTypeOption { value: 'FREE_15' | 'GAP_CLOSING' | 'LIA'; label: string; requiresLia: boolean; }

export const SESSION_TYPES: SessionTypeOption[] = [
  { value: 'FREE_15', label: 'Free 15-min', requiresLia: false },
  { value: 'GAP_CLOSING', label: 'Gap-Closing (30m)', requiresLia: false },
  { value: 'LIA', label: 'LIA Consultation (45m)', requiresLia: true },
];

export function sessionTypeLabel(value: string): string {
  return SESSION_TYPES.find((s) => s.value === value)?.label ?? value;
}

// A short, practical IANA timezone list (extend as needed).
export const TIMEZONES: string[] = [
  'Pacific/Auckland',
  'Australia/Sydney',
  'Asia/Kuala_Lumpur',
  'Asia/Dubai',
  'Asia/Tehran',
  'Asia/Kolkata',
  'Europe/London',
  'UTC',
];

export const WEEKDAYS = [
  { dow: 1, label: 'Monday' },
  { dow: 2, label: 'Tuesday' },
  { dow: 3, label: 'Wednesday' },
  { dow: 4, label: 'Thursday' },
  { dow: 5, label: 'Friday' },
  { dow: 6, label: 'Saturday' },
  { dow: 0, label: 'Sunday' },
];

// minutes-from-midnight <-> "HH:MM" helpers for the weekly-hours editor.
export function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
