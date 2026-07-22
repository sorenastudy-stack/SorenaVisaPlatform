// Minimal iCalendar (.ics) builder for adding a staff meeting to a personal
// calendar (Outlook / Google / Apple). A static download — no calendar API or
// OAuth. RFC 5545 VEVENT with a 15-minute DISPLAY reminder (VALARM).

export interface IcsMeeting {
  id: string;
  clientName: string;
  typeLabel: string;              // e.g. "LIA Consultation"
  scheduledAt: string;            // ISO
  scheduledEndAt?: string | null; // ISO; falls back to start + duration
  durationMinutes?: number | null;
  meetingLink?: string | null;    // Jitsi URL
}

// Date → "YYYYMMDDTHHMMSSZ" (UTC).
function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Escape per RFC 5545 (backslash, semicolon, comma, newline).
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function buildIcs(m: IcsMeeting): string {
  const start = new Date(m.scheduledAt);
  const end = m.scheduledEndAt
    ? new Date(m.scheduledEndAt)
    : new Date(start.getTime() + (m.durationMinutes ?? 30) * 60_000);

  const summary = `${m.typeLabel} with ${m.clientName}`;
  const link = m.meetingLink ?? '';
  const description = link
    ? `Consultation with ${m.clientName}. Join: ${link}`
    : `Consultation with ${m.clientName}.`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sorena Visa//Staff Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.id}@sorenavisa.com`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    ...(link ? [`LOCATION:${esc(link)}`, `URL:${esc(link)}`] : []),
    // 15-minute reminder so the staff member gets their own alert.
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

// Trigger a browser download of the .ics for one meeting.
export function downloadIcs(m: IcsMeeting, filename?: string): void {
  const blob = new Blob([buildIcs(m)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `sorena-meeting-${m.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
