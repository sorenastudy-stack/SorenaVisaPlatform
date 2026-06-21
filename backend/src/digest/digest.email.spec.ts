/**
 * Phase 8 — pure-helper tests for the digest email layer.
 *
 * Two surfaces under test:
 *   1. renderDigestItem  — one sentence per event type, null-tolerant
 *   2. buildDigestEmail  — populated + empty branches, subject + HTML
 *
 * Both are pure functions; no Prisma, no Nest, no nodemailer.
 */

import {
  buildDigestEmail,
  formatAmount,
  formatFriendlyDate,
  formatShortDate,
  renderDigestItem,
} from './digest.email';
import type { DigestItem } from './digest.types';

// ─── Formatters ─────────────────────────────────────────────────────────

describe('formatAmount', () => {
  it('formats integer cents + lowercase currency → "NZD 50.00"', () => {
    expect(formatAmount(5000,  'nzd')).toBe('NZD 50.00');
    expect(formatAmount(9999,  'nzd')).toBe('NZD 99.99');
    expect(formatAmount(1,     'usd')).toBe('USD 0.01');
    expect(formatAmount(0,     'nzd')).toBe('NZD 0.00');
    expect(formatAmount(20000, 'NZD')).toBe('NZD 200.00');
  });
});

describe('formatFriendlyDate', () => {
  it('produces "Friday 27 June" style strings deterministically (UTC components)', () => {
    expect(formatFriendlyDate(new Date('2026-06-26T10:00:00Z'))).toBe('Friday 26 June');
    expect(formatFriendlyDate(new Date('2027-01-04T00:00:00Z'))).toBe('Monday 4 January');
    expect(formatFriendlyDate(new Date('2026-12-25T12:00:00Z'))).toBe('Friday 25 December');
  });
  it('returns null for null or invalid input', () => {
    expect(formatFriendlyDate(null)).toBeNull();
    expect(formatFriendlyDate(new Date('not-a-date'))).toBeNull();
  });
});

describe('formatShortDate', () => {
  it('returns "27 June 2027" style strings from ISO input', () => {
    expect(formatShortDate('2027-06-27T00:00:00Z')).toBe('27 June 2027');
    expect(formatShortDate('2027-06-27')).toBe('27 June 2027');
  });
  it('returns null on missing or unparseable input', () => {
    expect(formatShortDate(null)).toBeNull();
    expect(formatShortDate('')).toBeNull();
    expect(formatShortDate('not-a-date-at-all')).toBeNull();
  });
});

// ─── Per-item rendering ─────────────────────────────────────────────────

const FIXED_TIME = new Date('2026-06-18T10:00:00Z');

describe('renderDigestItem', () => {
  it('PAYMENT_RECORDED_MANUAL — formats amount + currency', () => {
    expect(renderDigestItem({
      type: 'PAYMENT_RECORDED_MANUAL',
      occurredAt: FIXED_TIME,
      data: { amount: 5000, currency: 'nzd' },
    })).toBe('We recorded your payment of NZD 50.00.');
  });

  it('PAYMENT_VERIFICATION_CONFIRMED — past-tense confirmation copy', () => {
    expect(renderDigestItem({
      type: 'PAYMENT_VERIFICATION_CONFIRMED',
      occurredAt: FIXED_TIME,
      data: { amount: 20000, currency: 'nzd' },
    })).toBe('Your payment of NZD 200.00 was confirmed.');
  });

  it('INZ_SUBMITTED — with reference', () => {
    expect(renderDigestItem({
      type: 'INZ_SUBMITTED',
      occurredAt: FIXED_TIME,
      data: { reference: 'INZ-ABC-123' },
    })).toBe('Your application was lodged with Immigration New Zealand. Reference: INZ-ABC-123.');
  });

  it('INZ_SUBMITTED — null reference falls back gracefully (no "null" in output)', () => {
    const s = renderDigestItem({
      type: 'INZ_SUBMITTED',
      occurredAt: FIXED_TIME,
      data: { reference: null },
    });
    expect(s).toBe('Your application was lodged with Immigration New Zealand.');
    expect(s).not.toMatch(/null|undefined/i);
  });

  it('VISA_ISSUED — with both dates', () => {
    expect(renderDigestItem({
      type: 'VISA_ISSUED',
      occurredAt: FIXED_TIME,
      data: { visaStartDate: '2027-06-27T00:00:00Z', visaEndDate: '2030-06-27T00:00:00Z' },
    })).toBe(`Your visa has been issued. It's valid from 27 June 2027 to 27 June 2030.`);
  });

  it('VISA_ISSUED — both dates null falls back', () => {
    const s = renderDigestItem({
      type: 'VISA_ISSUED',
      occurredAt: FIXED_TIME,
      data: { visaStartDate: null, visaEndDate: null },
    });
    expect(s).toBe('Your visa has been issued.');
    expect(s).not.toMatch(/null|undefined/i);
  });

  it('VISA_ISSUED — only one date present still falls back (avoids half-string)', () => {
    const s = renderDigestItem({
      type: 'VISA_ISSUED',
      occurredAt: FIXED_TIME,
      data: { visaStartDate: '2027-06-27', visaEndDate: null },
    });
    expect(s).toBe('Your visa has been issued.');
  });

  it('LIA_AUTO_ASSIGNED — with staff name', () => {
    expect(renderDigestItem({
      type: 'LIA_AUTO_ASSIGNED',
      occurredAt: FIXED_TIME,
      data: { staffName: 'Mira Adviser' },
    })).toBe('Mira Adviser is now your immigration adviser.');
  });

  it('LIA_AUTO_ASSIGNED — null name falls back to "Your immigration adviser has been assigned."', () => {
    const s = renderDigestItem({
      type: 'LIA_AUTO_ASSIGNED',
      occurredAt: FIXED_TIME,
      data: { staffName: null },
    });
    expect(s).toBe('Your immigration adviser has been assigned.');
    expect(s).not.toMatch(/null|undefined/i);
  });

  it('LIA_MANUAL_REASSIGNED — same sentence pattern as auto', () => {
    expect(renderDigestItem({
      type: 'LIA_MANUAL_REASSIGNED',
      occurredAt: FIXED_TIME,
      data: { staffName: 'Eli Reassigned' },
    })).toBe('Eli Reassigned is now your immigration adviser.');
  });

  it('CASE_DOCUMENT_REQUESTED — friendly request copy', () => {
    expect(renderDigestItem({
      type: 'CASE_DOCUMENT_REQUESTED',
      occurredAt: FIXED_TIME,
      data: { documentLabel: 'Passport scan' },
    })).toBe('Your adviser requested a document: Passport scan.');
  });

  it('MEETING_CREATED — with scheduled time', () => {
    expect(renderDigestItem({
      type: 'MEETING_CREATED',
      occurredAt: FIXED_TIME,
      data: { when: new Date('2026-06-26T14:00:00Z') },
    })).toBe('A meeting was scheduled for Friday 26 June.');
  });

  it('MEETING_CREATED — null when falls back', () => {
    expect(renderDigestItem({
      type: 'MEETING_CREATED',
      occurredAt: FIXED_TIME,
      data: { when: null },
    })).toBe('A meeting was scheduled.');
  });

  it('MEETING_UPDATED — "rescheduled to ..."', () => {
    expect(renderDigestItem({
      type: 'MEETING_UPDATED',
      occurredAt: FIXED_TIME,
      data: { when: new Date('2026-06-26T14:00:00Z') },
    })).toBe('Your meeting was rescheduled to Friday 26 June.');
  });

  it('MEETING_UPDATED — null when falls back', () => {
    expect(renderDigestItem({
      type: 'MEETING_UPDATED',
      occurredAt: FIXED_TIME,
      data: { when: null },
    })).toBe('Your meeting was rescheduled.');
  });

  it('MEETING_CANCELLED — fixed copy', () => {
    expect(renderDigestItem({
      type: 'MEETING_CANCELLED',
      occurredAt: FIXED_TIME,
      data: { when: null },
    })).toBe('A meeting was cancelled.');
  });

  it('DOCUMENT_UPLOADED — names the file', () => {
    expect(renderDigestItem({
      type: 'DOCUMENT_UPLOADED',
      occurredAt: FIXED_TIME,
      data: { documentName: 'Visa decision letter.pdf' },
    })).toBe('A new document was added to your case: Visa decision letter.pdf.');
  });

  it('TICKET_MESSAGE_SENT — references the topic', () => {
    expect(renderDigestItem({
      type: 'TICKET_MESSAGE_SENT',
      occurredAt: FIXED_TIME,
      data: { ticketTopic: 'receipt question' },
    })).toBe('Your support team replied to your enquiry about receipt question.');
  });

  it('TICKET_STATUS_CHANGED — RESOLVED lowercased to "resolved"', () => {
    expect(renderDigestItem({
      type: 'TICKET_STATUS_CHANGED',
      occurredAt: FIXED_TIME,
      data: { ticketTopic: 'receipt question', newStatus: 'RESOLVED' },
    })).toBe('Your support enquiry about receipt question was resolved.');
  });

  it('TICKET_STATUS_CHANGED — CLOSED lowercased to "closed"', () => {
    expect(renderDigestItem({
      type: 'TICKET_STATUS_CHANGED',
      occurredAt: FIXED_TIME,
      data: { ticketTopic: 'docs help', newStatus: 'CLOSED' },
    })).toBe('Your support enquiry about docs help was closed.');
  });

  it('no rendered sentence ever contains the words "null", "undefined", or an internal field name', () => {
    const allItems: DigestItem[] = [
      { type: 'PAYMENT_RECORDED_MANUAL',        occurredAt: FIXED_TIME, data: { amount: 0, currency: 'nzd' } },
      { type: 'PAYMENT_VERIFICATION_CONFIRMED', occurredAt: FIXED_TIME, data: { amount: 0, currency: 'nzd' } },
      { type: 'INZ_SUBMITTED',                  occurredAt: FIXED_TIME, data: { reference: null } },
      { type: 'VISA_ISSUED',                    occurredAt: FIXED_TIME, data: { visaStartDate: null, visaEndDate: null } },
      { type: 'LIA_AUTO_ASSIGNED',              occurredAt: FIXED_TIME, data: { staffName: null } },
      { type: 'LIA_MANUAL_REASSIGNED',          occurredAt: FIXED_TIME, data: { staffName: null } },
      { type: 'CASE_DOCUMENT_REQUESTED',        occurredAt: FIXED_TIME, data: { documentLabel: 'x' } },
      { type: 'MEETING_CREATED',                occurredAt: FIXED_TIME, data: { when: null } },
      { type: 'MEETING_UPDATED',                occurredAt: FIXED_TIME, data: { when: null } },
      { type: 'MEETING_CANCELLED',              occurredAt: FIXED_TIME, data: { when: null } },
      { type: 'DOCUMENT_UPLOADED',              occurredAt: FIXED_TIME, data: { documentName: 'x.pdf' } },
      { type: 'TICKET_MESSAGE_SENT',            occurredAt: FIXED_TIME, data: { ticketTopic: 'x' } },
      { type: 'TICKET_STATUS_CHANGED',          occurredAt: FIXED_TIME, data: { ticketTopic: 'x', newStatus: 'RESOLVED' } },
    ];
    for (const item of allItems) {
      const s = renderDigestItem(item);
      expect(s).not.toMatch(/null|undefined/i);
      expect(s).not.toMatch(/entityId|entityType|actorRoleSnapshot|newValue|paymentId|leadId|caseId/i);
    }
  });
});

// ─── Email assembly ─────────────────────────────────────────────────────

const PORTAL_URL = 'https://app.sorenavisa.com/portal/case';

describe('buildDigestEmail — populated branch', () => {
  it('uses the same subject as the empty branch (clients can\'t infer "nothing happened" from the subject)', () => {
    const a = buildDigestEmail('Test', [], PORTAL_URL);
    const b = buildDigestEmail('Test', [
      { type: 'INZ_SUBMITTED', occurredAt: FIXED_TIME, data: { reference: 'INZ-1' } },
    ], PORTAL_URL);
    expect(a.subject).toBe(b.subject);
    expect(a.subject).toBe('Your Sorena weekly update');
  });

  it('greets by name and renders each item as a list bullet', () => {
    const { html } = buildDigestEmail('Test Client', [
      { type: 'INZ_SUBMITTED',       occurredAt: FIXED_TIME, data: { reference: 'INZ-1' } },
      { type: 'PAYMENT_RECORDED_MANUAL', occurredAt: FIXED_TIME, data: { amount: 5000, currency: 'nzd' } },
    ], PORTAL_URL);
    expect(html).toContain('Hi Test Client,');
    expect(html).toContain("Here's what happened with your application this week:");
    expect(html).toContain('Your application was lodged with Immigration New Zealand. Reference: INZ-1.');
    expect(html).toContain('We recorded your payment of NZD 50.00.');
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
  });

  it('renders the portal button with the supplied URL', () => {
    const { html } = buildDigestEmail('Test', [
      { type: 'INZ_SUBMITTED', occurredAt: FIXED_TIME, data: { reference: null } },
    ], PORTAL_URL);
    expect(html).toContain(`href="${PORTAL_URL}"`);
    expect(html).toContain('Log in to your portal');
  });

  it('signs off as the Sorena Visa Team', () => {
    const { html } = buildDigestEmail('Test', [
      { type: 'INZ_SUBMITTED', occurredAt: FIXED_TIME, data: { reference: null } },
    ], PORTAL_URL);
    expect(html).toContain('The Sorena Visa Team');
  });

  it('null clientName falls back to "there" (no "null Hi" leak)', () => {
    const { html } = buildDigestEmail(null, [
      { type: 'INZ_SUBMITTED', occurredAt: FIXED_TIME, data: { reference: null } },
    ], PORTAL_URL);
    expect(html).toContain('Hi there,');
    expect(html).not.toMatch(/Hi (null|undefined)/i);
  });

  it('html-escapes the client name and rendered sentences so injection-shaped chars render safely', () => {
    const { html } = buildDigestEmail('<script>x</script>', [
      { type: 'CASE_DOCUMENT_REQUESTED', occurredAt: FIXED_TIME, data: { documentLabel: 'P&P <bracket>' } },
    ], PORTAL_URL);
    // Original raw `<script>` MUST NOT survive — escape it.
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('P&amp;P &lt;bracket&gt;');
  });

  it('no rendered item leaks internal field names', () => {
    const { html } = buildDigestEmail('Test', [
      { type: 'PAYMENT_RECORDED_MANUAL',        occurredAt: FIXED_TIME, data: { amount: 5000, currency: 'nzd' } },
      { type: 'PAYMENT_VERIFICATION_CONFIRMED', occurredAt: FIXED_TIME, data: { amount: 5000, currency: 'nzd' } },
      { type: 'LIA_MANUAL_REASSIGNED',          occurredAt: FIXED_TIME, data: { staffName: 'X' } },
    ], PORTAL_URL);
    for (const leak of [
      'entityId', 'entityType', 'actorRoleSnapshot', 'newValue',
      'verificationStatus', 'verificationNote', 'reasonLength',
      'paymentId', 'leadId', 'receiptDocumentId',
    ]) {
      expect(html).not.toContain(leak);
    }
  });
});

describe('buildDigestEmail — empty branch', () => {
  it('reassuring copy, NOT an apology or implication of neglect', () => {
    const { html } = buildDigestEmail('Test Client', [], PORTAL_URL);
    expect(html).toContain('There were no new updates on your application this week.');
    expect(html).toContain('Your case is progressing');
    // Negative — none of these phrases should creep into the empty copy.
    expect(html).not.toMatch(/sorry|apologise|apologize|delayed|nothing|neglect/i);
  });

  it('still includes the portal button and sign-off', () => {
    const { html } = buildDigestEmail('Test Client', [], PORTAL_URL);
    expect(html).toContain(`href="${PORTAL_URL}"`);
    expect(html).toContain('Log in to your portal');
    expect(html).toContain('The Sorena Visa Team');
  });

  it('does NOT render the "here\'s what happened" intro or a <ul> list', () => {
    const { html } = buildDigestEmail('Test Client', [], PORTAL_URL);
    expect(html).not.toContain("Here's what happened");
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<li');
  });

  it('subject matches the populated branch verbatim', () => {
    const { subject } = buildDigestEmail('Test', [], PORTAL_URL);
    expect(subject).toBe('Your Sorena weekly update');
  });
});
