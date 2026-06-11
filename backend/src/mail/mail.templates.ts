// PR-EMAIL-1 — Branded email shell + per-email content fragments.
//
// One shared `wrapHtml()` produces the navy header + off-white body +
// gold accent footer that every email shares. All CSS is inline (email
// clients strip <style> blocks and don't understand classes). The
// shell tops out at 600px wide and centers — that's the safe column
// for Gmail / Outlook / Apple Mail.
//
// Content functions below each return ONLY the inner body HTML — the
// shell is applied by MailService.send() so we don't repeat the
// chrome 11 times.

const NAVY      = '#1E3A5F';
const GOLD      = '#E8B923';
const OFF_WHITE = '#FAF8F3';
const BODY      = '#4A4A4A';
const MUTED     = '#8B8B8B';

interface WrapOpts {
  /** Big gold heading above the body. Optional — most emails set it. */
  heading?: string;
  /** Override the website link in the footer (rare). */
  websiteUrl?: string;
}

export function wrapHtml(bodyHtml: string, opts: WrapOpts = {}): string {
  const websiteUrl = opts.websiteUrl ?? 'https://www.sorenavisa.com';
  const heading = opts.heading
    ? `<h1 style="margin:0 0 16px;color:${NAVY};font-size:22px;font-weight:700;line-height:1.3;">${opts.heading}</h1>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sorena Visa</title>
</head>
<body style="margin:0;padding:0;background:${OFF_WHITE};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BODY};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${OFF_WHITE};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(30,58,95,0.08);">
          <tr>
            <td style="background:${NAVY};padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td>
                    <div style="color:#FFFFFF;font-size:18px;font-weight:800;letter-spacing:0.5px;">Sorena Visa</div>
                    <div style="color:${GOLD};font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;">Education &amp; Immigration</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background:${GOLD};line-height:0;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px;color:${BODY};font-size:15px;line-height:1.6;">
              ${heading}
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:${OFF_WHITE};padding:20px 32px;border-top:1px solid #EFEAE0;">
              <div style="color:${NAVY};font-size:12px;font-weight:700;">Sorena Visa</div>
              <div style="color:${MUTED};font-size:11px;font-style:italic;margin-top:2px;">From assessment to arrival.</div>
              <div style="margin-top:8px;"><a href="${websiteUrl}" style="color:${NAVY};font-size:11px;text-decoration:none;">${websiteUrl}</a></div>
            </td>
          </tr>
        </table>
        <div style="color:${MUTED};font-size:11px;margin-top:12px;">You're receiving this because you have an active account with Sorena Visa.</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Shared primary button. Inline-styled so it survives email-client
// rewrites. Renders as a navy pill with a gold border accent.
export function primaryButton(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr><td style="background:${NAVY};border-radius:8px;"><a href="${href}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">${text}</a></td></tr></table>`;
}

// Small typed escape for user-supplied substitutions. Email content
// runs through here even for non-PII fields like names — defence
// against a stray apostrophe / angle bracket breaking the shell.
function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Per-email body fragments ─────────────────────────────────────

export function verificationEmailBody(name: string, url: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p>Thanks for getting in touch with Sorena Visa. Please verify your email address so we can get back to you with personalised next steps.</p>
    ${primaryButton('Verify my email', url)}
    <p style="color:${MUTED};font-size:13px;margin-top:24px;">This link expires in <strong>24 hours</strong>. If you didn't sign up, you can safely ignore this email.</p>
  `;
}

export function magicLinkLoginBody(name: string, url: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p>Here's your sign-in link for Sorena Visa. Click the button below and you'll be signed straight in — no password needed.</p>
    ${primaryButton('Sign in to Sorena Visa', url)}
    <p style="color:${MUTED};font-size:13px;margin-top:24px;">This link expires in <strong>15 minutes</strong> and can be used <strong>once</strong>. If you didn't request a sign-in link, you can safely ignore this email — your account stays put.</p>
  `;
}

export function welcomeEmailBody(name: string): string {
  return `
    <p>Welcome to Sorena Visa, ${esc(name)}.</p>
    <p>Thank you for choosing us for your study abroad journey. We're excited to help you achieve your goals in New Zealand or Malaysia.</p>
    <p>Our team will be in touch shortly to walk you through your next steps. In the meantime, feel free to reply directly to this email with any questions.</p>
  `;
}

export function admissionSubmittedToClientBody(name: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p>Your admission application has been received. Our team will review everything and be in touch within <strong>3–5 business days</strong>.</p>
    <p>If you have any questions in the meantime, send us a message through your portal and one of our advisors will get back to you.</p>
  `;
}

export function admissionSubmittedToOwnerBody(ownerName: string, clientName: string): string {
  return `
    <p>Hi ${esc(ownerName)},</p>
    <p><strong>${esc(clientName)}</strong> has submitted their admission application. Please review it in the staff portal at your earliest convenience.</p>
  `;
}

export function contractReadyBody(name: string, signingUrl: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p>Your contract is now ready for electronic signing. Please review the terms and sign so we can begin work on your application.</p>
    ${primaryButton('Review and sign', signingUrl)}
    <p style="color:${MUTED};font-size:13px;margin-top:24px;">This signing link expires in 30 days.</p>
  `;
}

export function newLiaAssignmentBody(liaName: string, caseId: string, clientName: string, link: string): string {
  return `
    <p>Hi ${esc(liaName)},</p>
    <p>You've been assigned as the LIA for <strong>${esc(clientName)}</strong>'s case (<code style="font-family:Menlo,Consolas,monospace;font-size:13px;color:${NAVY};">${esc(caseId.slice(0, 8))}</code>).</p>
    ${primaryButton('Open case', link)}
  `;
}

export function liaAssignmentReleasedBody(liaName: string, caseId: string): string {
  return `
    <p>Hi ${esc(liaName)},</p>
    <p>The case <code style="font-family:Menlo,Consolas,monospace;font-size:13px;color:${NAVY};">${esc(caseId.slice(0, 8))}</code> has been reassigned to another LIA. You no longer need to action it.</p>
  `;
}

export function inzSubmittedToClientBody(name: string, link: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p>Good news — your visa application has been lodged with <strong>Immigration New Zealand</strong>.</p>
    <p>INZ will process your application from here. We'll let you know the moment there's any news, or if they need anything additional from you. In the meantime there's nothing you need to do.</p>
    ${primaryButton('View your case', link)}
  `;
}

export function visaIssuedToClientBody(name: string, link: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p><strong>Congratulations — your visa has been issued!</strong></p>
    <p>Immigration New Zealand has approved your application. Your case advisor will share the visa document with you separately and walk you through the next steps for travel and arrival.</p>
    ${primaryButton('Open your case', link)}
    <p>We're delighted to have helped you reach this milestone, and we're here for everything that comes next.</p>
  `;
}

export function visaDeclinedToClientBody(name: string, link: string): string {
  return `
    <p>Hi ${esc(name)},</p>
    <p>We're writing with an update on your visa application. <strong>Immigration New Zealand did not approve your application.</strong></p>
    <p>This isn't the outcome any of us wanted — but it isn't the end of the road. Your case advisor will be in touch shortly to walk you through your options, which may include addressing INZ's concerns and re-applying, or exploring an alternative pathway.</p>
    ${primaryButton('Open your case', link)}
    <p>We're here to help you find the right next step.</p>
  `;
}

export function visaExpiryReminderToLiaBody(
  liaName: string,
  clientName: string,
  endDateStr: string,
  daysRemaining: number,
  link: string,
): string {
  return `
    <p>Hi ${esc(liaName)},</p>
    <p><strong>${esc(clientName)}</strong>'s visa expires on <strong>${esc(endDateStr)}</strong> — about <strong>${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong> away.</p>
    <p>This is a good moment to start the renewal conversation with the client if they're planning to stay.</p>
    ${primaryButton('Open case', link)}
  `;
}

export function visaExpiryReminderToClientBody(
  clientName: string,
  endDateStr: string,
  daysRemaining: number,
  link: string,
): string {
  return `
    <p>Hi ${esc(clientName)},</p>
    <p>A friendly reminder that your visa is currently valid until <strong>${esc(endDateStr)}</strong> — about <strong>${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong> from today.</p>
    <p>If you'd like to talk through your options, your case advisor is ready to help.</p>
    ${primaryButton('Open messages', link)}
  `;
}

export function visaExpiryReminderToOwnerBody(
  ownerName: string,
  clientName: string,
  liaName: string | null,
  endDateStr: string,
  daysRemaining: number,
  link: string,
): string {
  return `
    <p>Hi ${esc(ownerName)},</p>
    <p><strong>${esc(clientName)}</strong>'s visa expires on <strong>${esc(endDateStr)}</strong> (${daysRemaining} day${daysRemaining === 1 ? '' : 's'}). Their assigned LIA is <strong>${esc(liaName ?? 'unassigned')}</strong>.</p>
    <p>This is a potential renewal engagement. The LIA has also been notified.</p>
    ${primaryButton('Open case', link)}
  `;
}

export function ticketReplyNotificationBody(clientName: string, link: string): string {
  return `
    <p>Hi ${esc(clientName)},</p>
    <p>You have a new reply on your support ticket.</p>
    <p>For security, the reply itself stays inside your portal. Open the ticket to read and respond:</p>
    ${primaryButton('View your ticket', link)}
  `;
}
