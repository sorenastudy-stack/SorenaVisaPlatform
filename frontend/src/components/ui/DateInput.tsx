'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// PR-DATE-INPUT — Shared 3-dropdown date picker replacing every native
// <input type="date"> in the visa form. Native date inputs allowed
// year 0055 typing bugs (user types "55" → year 0055), so the form
// is now Day · Month · Year selects with bounded options. Mobile-
// friendly 48px touch targets, brand-matched styling.

export type DateInputProps = {
  // ISO date string from the API. Accepts both "YYYY-MM-DD" and a
  // full ISO datetime ("YYYY-MM-DDT00:00:00.000Z").
  value: string | null;
  // Emits "YYYY-MM-DD" when all three dropdowns are filled, null
  // otherwise. Partial selection yields null so the existing
  // validation can still see the field as missing.
  onChange: (iso: string | null) => void;
  minYear?: number;          // default 1900
  maxYear?: number;          // default = current year
  ariaInvalid?: boolean;
  disabled?: boolean;
};

// Parse via regex first (cheap + timezone-safe). Falls back to
// new Date() with UTC getters so a "YYYY-MM-DD" string never shifts
// by a day across the NZ/Iran timezone boundary — same fix we
// applied to the INZ viewer polish.
function parseValue(value: string | null): { day: string; month: string; year: string } {
  if (!value) return { day: '', month: '', year: '' };
  const trimmed = String(value).trim();
  if (!trimmed) return { day: '', month: '', year: '' };
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return {
      year:  String(parseInt(m[1], 10)),
      month: String(parseInt(m[2], 10)),
      day:   String(parseInt(m[3], 10)),
    };
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return { day: '', month: '', year: '' };
  return {
    year:  String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1),
    day:   String(d.getUTCDate()),
  };
}

function daysInMonth(month: number, year: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    return leap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function pad2(n: number | string): string {
  const s = String(n);
  return s.length < 2 ? '0' + s : s;
}

const CURRENT_YEAR = new Date().getFullYear();

export function DateInput({
  value,
  onChange,
  minYear = 1900,
  maxYear = CURRENT_YEAR,
  ariaInvalid = false,
  disabled = false,
}: DateInputProps) {
  const initial = parseValue(value);
  const [day,   setDay]   = useState<string>(initial.day);
  const [month, setMonth] = useState<string>(initial.month);
  const [year,  setYear]  = useState<string>(initial.year);

  // Sync local state when the parent's value prop changes externally
  // (e.g. on initial API load, or when the parent resets the field).
  // We only adopt the parsed parent value when it's fully-formed —
  // otherwise we leave the local partial selection alone so we don't
  // stomp on a user mid-pick. An explicit null/empty from the parent
  // resets the local state in full.
  const lastSeenValue = useRef<string | null>(value);
  useEffect(() => {
    if (lastSeenValue.current === value) return;
    lastSeenValue.current = value;
    const next = parseValue(value);
    if (next.day && next.month && next.year) {
      setDay(next.day);
      setMonth(next.month);
      setYear(next.year);
    } else if (!value) {
      setDay('');
      setMonth('');
      setYear('');
    }
  }, [value]);

  const emit = (d: string, m: string, y: string) => {
    if (d && m && y) onChange(`${y}-${pad2(m)}-${pad2(d)}`);
    else onChange(null);
  };

  const onDayChange = (d: string) => {
    setDay(d);
    emit(d, month, year);
  };

  // Day-clamping: when month or year changes, if the currently-picked
  // day is invalid for the new (month, year) — e.g. Feb 30, Apr 31 —
  // silently snap to the max valid day for that month.
  const onMonthChange = (m: string) => {
    let clamped = day;
    if (m && year && day) {
      const max = daysInMonth(parseInt(m, 10), parseInt(year, 10));
      if (parseInt(day, 10) > max) clamped = String(max);
    }
    setMonth(m);
    if (clamped !== day) setDay(clamped);
    emit(clamped, m, year);
  };

  const onYearChange = (y: string) => {
    let clamped = day;
    if (y && month && day) {
      const max = daysInMonth(parseInt(month, 10), parseInt(y, 10));
      if (parseInt(day, 10) > max) clamped = String(max);
    }
    setYear(y);
    if (clamped !== day) setDay(clamped);
    emit(clamped, month, y);
  };

  // Day options shrink to (month, year)'s actual day count so
  // invalid dates can't be picked. Defaults to 31 when month/year
  // not yet selected.
  const maxDay = (month && year)
    ? daysInMonth(parseInt(month, 10), parseInt(year, 10))
    : 31;

  // Years descending (most recent first) — same UX as a native
  // date-picker year dropdown.
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = maxYear; y >= minYear; y--) out.push(y);
    return out;
  }, [minYear, maxYear]);

  // Brand-matched select styling; aria-invalid drives a red border to
  // mirror the rest of the form's error treatment.
  const selectClass = [
    'h-12 rounded-lg border bg-white px-2 text-sm text-sorena-navy focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
    ariaInvalid ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
  ].join(' ');

  return (
    <div className="flex gap-2">
      <select
        value={day}
        onChange={(e) => onDayChange(e.target.value)}
        disabled={disabled}
        aria-label="Day"
        className={`${selectClass} min-w-[4.5rem]`}
      >
        <option value="">Day</option>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
          <option key={d} value={String(d)}>{pad2(d)}</option>
        ))}
      </select>
      <select
        value={month}
        onChange={(e) => onMonthChange(e.target.value)}
        disabled={disabled}
        aria-label="Month"
        className={`${selectClass} min-w-[4.5rem]`}
      >
        <option value="">Month</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={String(m)}>{pad2(m)}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => onYearChange(e.target.value)}
        disabled={disabled}
        aria-label="Year"
        className={`${selectClass} min-w-[5.5rem]`}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>
    </div>
  );
}
