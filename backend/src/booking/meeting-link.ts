import { randomBytes } from 'crypto';

// PR-BOOKING-5 — per-booking Jitsi meeting URL.
//
// Jitsi rooms exist on first visit — no account/API needed. We make the
// room PATH long and UNGUESSABLE (consultation id + a 128-bit crypto-
// random token) so the public room is effectively private. Generated
// ONCE per booking at confirm time and stored on Consultation.meetingLink.
//
// We also set a friendly meeting TITLE via Jitsi URL-hash config so the
// join screen shows the session name (e.g. "Sorena — Gap-Closing
// Consultation") instead of the raw room id. `config.subject` sets the
// title for everyone; `config.localSubject` is a reliable fallback on
// public meet.jit.si (which can restrict subject changes to moderators).

const MEETING_TITLES: Record<string, string> = {
  FREE_15:     'Sorena Visa — Free 15-minute Consultation',
  GAP_CLOSING: 'Sorena Visa — Gap-Closing Consultation',
  LIA:         'Sorena Visa — LIA Consultation',
};

export function meetingTitleFor(sessionType: string): string {
  return MEETING_TITLES[sessionType] ?? 'Sorena Visa Consultation';
}

export function buildJitsiUrl(consultationId: string, sessionType: string): string {
  const token = randomBytes(16).toString('hex'); // 128 bits, URL-safe hex
  const room = `sorena-${consultationId}-${token}`;

  // Jitsi URL-hash config values are URL-encoded JSON — a string needs its
  // surrounding quotes. Set both subject + localSubject for robustness.
  const enc = encodeURIComponent(`"${meetingTitleFor(sessionType)}"`);
  return `https://meet.jit.si/${room}#config.subject=${enc}&config.localSubject=${enc}`;
}
