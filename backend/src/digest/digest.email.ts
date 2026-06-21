import type { DigestItem } from './digest.types';

// Phase 8 — digest email rendering layer.
//
// Two pure helpers + small formatters. No I/O, no Prisma, no Logger.
//
//   renderDigestItem(item)            → ONE warm English sentence
//   buildDigestEmail(name, items, url) → { subject, html } ready to send
//
// Tone rules: clients are usually anxious about immigration. Sentences
// should be calm, specific, and never imply alarm. The empty-week
// fallback exists because silence reads as "nothing is happening" — we
// counter that explicitly with reassuring copy + the portal CTA.

// ─── Formatters ──────────────────────────────────────────────────────────

const MONTHS = [
  'January',  'February', 'March',     'April',
  'May',      'June',     'July',      'August',
  'September','October',  'November',  'December',
];

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
];

/**
 * Format integer cents → uppercased-currency money string.
 * Mirrors the Payments tab convention: 5000 / "nzd" → "NZD 50.00".
 */
export function formatAmount(cents: number, currency: string): string {
  const dollars = (cents / 100).toFixed(2);
  return `${currency.toUpperCase()} ${dollars}`;
}

/**
 * Friendly date for a meeting time: "Friday 27 June".
 * Deterministic — uses UTC components so the same Date yields the same
 * string in CI / local / prod regardless of system timezone.
 */
export function formatFriendlyDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Compact date for a visa-validity span: "27 June 2027".
 * Accepts ISO strings (the audit payload carries these). Returns null
 * on parse failure so the caller can omit the line gracefully.
 */
export function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// HTML-escape used on every interpolated client-facing string. The
// values come from staff (LIA name, document name, ticket subject,
// requestedDocType) so an unescaped `<` or `&` would render wrong AND
// — worst case — open an injection vector if a future code path lets
// raw HTML reach the audit `newValue`. Belt + braces.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Per-item sentence renderer ──────────────────────────────────────────

export function renderDigestItem(item: DigestItem): string {
  switch (item.type) {
    case 'PAYMENT_RECORDED_MANUAL':
      return `We recorded your payment of ${formatAmount(item.data.amount, item.data.currency)}.`;

    case 'PAYMENT_VERIFICATION_CONFIRMED':
      return `Your payment of ${formatAmount(item.data.amount, item.data.currency)} was confirmed.`;

    case 'INZ_SUBMITTED':
      return item.data.reference
        ? `Your application was lodged with Immigration New Zealand. Reference: ${item.data.reference}.`
        : `Your application was lodged with Immigration New Zealand.`;

    case 'VISA_ISSUED': {
      const from = formatShortDate(item.data.visaStartDate);
      const to   = formatShortDate(item.data.visaEndDate);
      if (from && to) {
        return `Your visa has been issued. It's valid from ${from} to ${to}.`;
      }
      return `Your visa has been issued.`;
    }

    case 'LIA_AUTO_ASSIGNED':
    case 'LIA_MANUAL_REASSIGNED':
      return item.data.staffName
        ? `${item.data.staffName} is now your immigration adviser.`
        : `Your immigration adviser has been assigned.`;

    case 'CASE_DOCUMENT_REQUESTED':
      return `Your adviser requested a document: ${item.data.documentLabel}.`;

    case 'MEETING_CREATED': {
      const when = formatFriendlyDate(item.data.when);
      return when
        ? `A meeting was scheduled for ${when}.`
        : `A meeting was scheduled.`;
    }

    case 'MEETING_UPDATED': {
      const when = formatFriendlyDate(item.data.when);
      return when
        ? `Your meeting was rescheduled to ${when}.`
        : `Your meeting was rescheduled.`;
    }

    case 'MEETING_CANCELLED':
      return `A meeting was cancelled.`;

    case 'DOCUMENT_UPLOADED':
      return `A new document was added to your case: ${item.data.documentName}.`;

    case 'TICKET_MESSAGE_SENT':
      return `Your support team replied to your enquiry about ${item.data.ticketTopic}.`;

    case 'TICKET_STATUS_CHANGED':
      return `Your support enquiry about ${item.data.ticketTopic} was ${item.data.newStatus.toLowerCase()}.`;
  }
}

// ─── Email builder ───────────────────────────────────────────────────────

export interface BuiltEmail {
  subject: string;
  html:    string;
}

const DIGEST_SUBJECT = 'Your Sorena weekly update';

// Palette: navy header bar + cream footer + gold CTA — mirrors the
// staff Payments tab's calm Sorena look without depending on external
// CSS (which most email clients strip).
const COL_NAVY   = '#1e3a5f';
const COL_NAVY_2 = '#162d4a';
const COL_GOLD   = '#c9a961';
const COL_GOLD_2 = '#b8985a';
const COL_CREAM  = '#faf8f3';
const COL_INK    = '#1f2937';
const COL_MUTED  = '#4b5563';
const COL_FAINT  = '#9ca3af';
const COL_DIV    = '#e5e7eb';

/**
 * Build the Friday digest email for ONE client.
 *
 * Subject is identical for the populated and empty branches so an
 * empty-week recipient can't infer "nothing is happening" from the
 * subject line. The empty branch leans on calm, specific reassurance
 * — never apologises, never implies neglect.
 *
 * Inline styles only (Gmail / Outlook / Apple Mail all strip <style>
 * blocks or apply them inconsistently). Layout uses table-based rows
 * for maximum email-client compatibility.
 */
export function buildDigestEmail(
  clientName: string | null,
  items:      DigestItem[],
  portalUrl:  string,
): BuiltEmail {
  const safeName = escapeHtml((clientName ?? '').trim() || 'there');
  const safeUrl  = escapeHtml(portalUrl);

  const body = items.length > 0
    ? renderPopulatedBody(items)
    : renderEmptyBody();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(DIGEST_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:${COL_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${COL_INK};line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COL_CREAM};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${COL_DIV};">
          <tr>
            <td style="background:${COL_NAVY};padding:20px 32px;color:#ffffff;">
              <div style="font-size:18px;font-weight:700;letter-spacing:0.3px;">Sorena Visa</div>
              <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">Weekly update</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 18px;font-size:16px;">Hi ${safeName},</p>
              ${body}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
                <tr>
                  <td style="border-radius:8px;background:${COL_GOLD};">
                    <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:8px;">Log in to your portal</a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;font-size:15px;color:${COL_MUTED};">
                Best wishes,<br />
                The Sorena Visa Team
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:${COL_CREAM};padding:16px 32px;font-size:12px;color:${COL_FAINT};text-align:center;border-top:1px solid ${COL_DIV};">
              You're receiving this because you have an active application with Sorena Visa.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: DIGEST_SUBJECT, html };
  // Note: COL_NAVY_2 / COL_GOLD_2 are reserved for the future
  // hover/active states once Sorena ships a styled email theme; the
  // simple gold pill keeps the inline-only template lean.
  void COL_NAVY_2; void COL_GOLD_2;
}

function renderPopulatedBody(items: DigestItem[]): string {
  const lines = items.map((it) => `<li style="margin-bottom:8px;">${escapeHtml(renderDigestItem(it))}</li>`).join('');
  return `
    <p style="margin:0 0 16px;font-size:15px;color:${COL_MUTED};">
      Here's what happened with your application this week:
    </p>
    <ul style="margin:0 0 28px;padding:0 0 0 22px;font-size:15px;line-height:1.7;color:${COL_INK};">
      ${lines}
    </ul>
  `;
}

function renderEmptyBody(): string {
  return `
    <p style="margin:0 0 16px;font-size:15px;color:${COL_INK};">
      There were no new updates on your application this week.
    </p>
    <p style="margin:0 0 28px;font-size:15px;color:${COL_MUTED};">
      Your case is progressing and we'll be in touch as things move forward. We're here if you need anything.
    </p>
  `;
}
