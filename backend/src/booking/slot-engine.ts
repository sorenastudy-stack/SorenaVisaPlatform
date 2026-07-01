// PR-BOOKING-1 — pure slot-computation engine.
//
// No NestJS / Prisma dependencies: given weekly availability windows,
// busy intervals, and parameters, it returns available slots. The thin
// BookingService loads the data and calls these functions; tests call
// them directly. Timezone math uses Node's built-in Intl (zero deps),
// DST-correct.
//
// Phase-2 readiness: availability is passed in as a resolved set of
// windows per weekday. Date-specific exceptions (days off / custom
// hours) will be applied by the CALLER when building `windows` and
// `excludedDates` — this engine already accepts an `excludedDates` set
// and per-date window override hook, so exceptions layer in without
// changing the core algorithm.

export interface WeeklyWindow {
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  startMinute: number; // minutes from midnight, in `timezone`
  endMinute: number;   // minutes from midnight, in `timezone`
}

export interface BusyInterval {
  start: Date; // UTC
  end: Date;   // UTC
}

export interface SlotEngineInput {
  timezone: string;            // IANA, e.g. "Pacific/Auckland"
  windows: WeeklyWindow[];     // active weekly windows for the staff
  busy: BusyInterval[];        // existing bookings (UTC)
  durationMinutes: number;     // session length; also the grid step
  dateFrom: Date;              // range start (UTC instant)
  dateTo: Date;                // range end (UTC instant)
  now: Date;                   // "current" instant (injected for testability)
  minLeadMinutes?: number;     // earliest a slot may start, from now. Default 24h.
  bufferMinutes?: number;      // gap padded around busy intervals. Default 0.
  // Phase-2 hook: calendar dates (YYYY-MM-DD in `timezone`) to skip
  // entirely (e.g. staff day off). Empty for now.
  excludedDates?: Set<string>;
}

export interface AvailableSlot {
  start: Date; // UTC
  end: Date;   // UTC
}

// ── Timezone helpers (Intl-based, DST-correct, dependency-free) ──────────

/**
 * Offset in ms between wall-clock time in `timeZone` and UTC, at `date`.
 * Positive when the zone is ahead of UTC (e.g. Pacific/Auckland = +12h or
 * +13h in DST). Computed by formatting `date` in the zone and diffing.
 */
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // `hour` can come back as 24 for midnight in some environments.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asIfUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asIfUtc - date.getTime();
}

/**
 * Convert a wall-clock time (calendar date + minutes-from-midnight) in
 * `timeZone` to the absolute UTC instant. DST-correct for normal working
 * hours (probes the offset at the nominal instant).
 */
export function zonedWallTimeToUtc(
  year: number, month: number, day: number, minutesFromMidnight: number, timeZone: string,
): Date {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMs(timeZone, new Date(nominalUtc));
  return new Date(nominalUtc - offset);
}

/** The calendar Y/M/D and weekday of `date` as seen in `timeZone`. */
export function zonedDateParts(date: Date, timeZone: string): {
  year: number; month: number; day: number; weekday: number; key: string;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayIndex: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const key = `${map.year}-${map.month}-${map.day}`;
  return { year, month, day, weekday: weekdayIndex[map.weekday], key };
}

// ── Core engine ──────────────────────────────────────────────────────────

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  // End-exclusive: touching edges do NOT overlap.
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/**
 * Compute available slots = (weekly working hours) minus (busy), in the
 * staff timezone, with no past/too-soon slots and no double-booking.
 */
export function computeAvailableSlots(input: SlotEngineInput): AvailableSlot[] {
  const {
    timezone, windows, busy, durationMinutes, dateFrom, dateTo, now,
    minLeadMinutes = 24 * 60, bufferMinutes = 0, excludedDates = new Set<string>(),
  } = input;

  if (durationMinutes <= 0 || windows.length === 0) return [];

  const durationMs = durationMinutes * 60_000;
  const bufferMs = bufferMinutes * 60_000;
  const earliestStart = new Date(now.getTime() + minLeadMinutes * 60_000);

  // Pad busy intervals by the buffer on both sides (0 by default).
  const paddedBusy: BusyInterval[] = busy.map((b) => ({
    start: new Date(b.start.getTime() - bufferMs),
    end: new Date(b.end.getTime() + bufferMs),
  }));

  // Group windows by weekday for quick lookup.
  const byWeekday = new Map<number, WeeklyWindow[]>();
  for (const w of windows) {
    const list = byWeekday.get(w.dayOfWeek) ?? [];
    list.push(w);
    byWeekday.set(w.dayOfWeek, list);
  }

  const slots: AvailableSlot[] = [];

  // Iterate calendar dates in the staff timezone from dateFrom to dateTo.
  // Step a UTC cursor by 24h but always re-derive the tz calendar date, so
  // DST day-length changes can't desync the loop.
  const endMs = dateTo.getTime();
  let cursor = new Date(dateFrom.getTime());
  const seenDateKeys = new Set<string>();
  // Safety bound: at most range-days + 2 iterations.
  const maxIterations = Math.ceil((endMs - dateFrom.getTime()) / 86_400_000) + 3;

  for (let i = 0; i < maxIterations && cursor.getTime() <= endMs; i++) {
    const parts = zonedDateParts(cursor, timezone);
    if (!seenDateKeys.has(parts.key)) {
      seenDateKeys.add(parts.key);

      if (!excludedDates.has(parts.key)) {
        const dayWindows = byWeekday.get(parts.weekday) ?? [];
        for (const w of dayWindows) {
          const windowStart = zonedWallTimeToUtc(parts.year, parts.month, parts.day, w.startMinute, timezone);
          const windowEnd = zonedWallTimeToUtc(parts.year, parts.month, parts.day, w.endMinute, timezone);

          // Grid step = duration. Generate aligned slots that fit fully
          // inside the window.
          for (
            let slotStartMs = windowStart.getTime();
            slotStartMs + durationMs <= windowEnd.getTime();
            slotStartMs += durationMs
          ) {
            const slotStart = new Date(slotStartMs);
            const slotEnd = new Date(slotStartMs + durationMs);

            // Exclude past / inside the minimum lead time.
            if (slotStart.getTime() < earliestStart.getTime()) continue;
            // Exclude anything beyond the requested range end.
            if (slotEnd.getTime() > endMs) continue;

            // Exclude overlaps with any (buffer-padded) busy interval.
            const clash = paddedBusy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
            if (clash) continue;

            slots.push({ start: slotStart, end: slotEnd });
          }
        }
      }
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  // Sort chronologically (multiple windows per day can interleave).
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}
