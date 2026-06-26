import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Resend } from 'resend';

import {
  wrapHtml,
  verificationEmailBody,
  magicLinkLoginBody,
  welcomeEmailBody,
  admissionSubmittedToClientBody,
  admissionSubmittedToOwnerBody,
  contractReadyBody,
  newLiaAssignmentBody,
  liaAssignmentReleasedBody,
  inzSubmittedToClientBody,
  visaIssuedToClientBody,
  visaDeclinedToClientBody,
  visaExpiryReminderToLiaBody,
  visaExpiryReminderToClientBody,
  visaExpiryReminderToOwnerBody,
  ticketReplyNotificationBody,
  consultationConfirmationBody,
} from './mail.templates';

// PR-EMAIL-1 — Unified Resend-based email service.
//
// Replaces the split EmailService + NotificationsService pipelines.
// One transporter, one branded HTML shell, one env-var convention
// (RESEND_API_KEY + EMAIL_FROM + FRONTEND_URL).
//
// Safe defaults:
//   * If RESEND_API_KEY is missing, the service runs in MOCK mode —
//     every send method logs `[MAIL MOCK]` and returns. No throw.
//   * All public send methods wrap their Resend call in try/catch.
//     A delivery failure logs an error but NEVER re-throws. Email
//     must never block a business action (a failed welcome email
//     can't roll back a lead creation).
//
// This service does NOT replace EmailService or NotificationsService
// yet. Those stay in place until call sites are individually
// repointed in a follow-up PR. Coexistence is intentional.

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private client: Resend | null = null;
  private enabled = false;
  private from = '';
  private frontendUrl = '';

  onModuleInit() {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    this.from = process.env.EMAIL_FROM ?? 'Sorena Visa <noreply@sorenavisa.co.nz>';
    this.frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    if (!apiKey) {
      this.enabled = false;
      this.logger.warn(
        'MailService: RESEND_API_KEY not set — emails will be logged, not sent',
      );
      return;
    }
    this.client = new Resend(apiKey);
    this.enabled = true;
    this.logger.log(`MailService: Resend enabled (from=${this.from}, frontend=${this.frontendUrl})`);
  }

  // ─── Public send methods ──────────────────────────────────────────

  async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const url = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send({
      to,
      subject: 'Verify your email — Sorena Visa',
      html: wrapHtml(verificationEmailBody(name, url), { heading: 'Verify your email' }),
    });
  }

  // PR-OPTION-C step 3 — magic-link sign-in email. Caller (MagicLinkService)
  // is responsible for building the FULL verify URL — it points at the
  // backend's /auth/magic-link/verify route, not at this.frontendUrl. We
  // accept the pre-built URL so the link target can include the raw
  // token + email as query params without this service knowing the route
  // shape.
  async sendMagicLinkLogin(to: string, name: string, url: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Sorena Visa login link',
      html: wrapHtml(magicLinkLoginBody(name, url), { heading: 'Sign in to Sorena Visa' }),
    });
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.send({
      to,
      subject: 'Welcome to Sorena Visa',
      html: wrapHtml(welcomeEmailBody(name), { heading: `Welcome, ${escapeHeading(name)}` }),
    });
  }

  async sendAdmissionSubmittedToClient(to: string, name: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Sorena application has been submitted',
      html: wrapHtml(admissionSubmittedToClientBody(name), {
        heading: 'Application submitted',
      }),
    });
  }

  async sendAdmissionSubmittedToOwner(
    to: string,
    ownerName: string,
    clientName: string,
  ): Promise<void> {
    await this.send({
      to,
      subject: `New application submitted: ${clientName}`,
      html: wrapHtml(admissionSubmittedToOwnerBody(ownerName, clientName), {
        heading: 'New admission application',
      }),
    });
  }

  async sendContractReady(to: string, name: string, signingUrl: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Sorena Visa contract is ready to sign',
      html: wrapHtml(contractReadyBody(name, signingUrl), {
        heading: 'Contract ready for signing',
      }),
    });
  }

  async sendNewLiaAssignment(
    to: string,
    liaName: string,
    caseId: string,
    clientName: string,
  ): Promise<void> {
    const link = `${this.frontendUrl}/lia/cases/${caseId}`;
    await this.send({
      to,
      subject: `New case assigned: ${clientName}`,
      html: wrapHtml(newLiaAssignmentBody(liaName, caseId, clientName, link), {
        heading: 'New case assigned to you',
      }),
    });
  }

  // EMAIL-MIGRATION: optional `clientName` matches what the LIA-assignment
  // service has been passing through NotificationsService all along.
  async sendLiaAssignmentReleased(
    to:          string,
    liaName:     string,
    caseId:      string,
    clientName?: string,
  ): Promise<void> {
    const subject = clientName ? `Case reassigned: ${clientName}` : 'Case reassigned';
    await this.send({
      to,
      subject,
      html: wrapHtml(liaAssignmentReleasedBody(liaName, caseId, clientName), {
        heading: 'Case reassigned',
      }),
    });
  }

  // EMAIL-MIGRATION: optional `inzApplicationNumber` — the Phase LIA-7
  // submission service already passes one through to its old transport.
  async sendInzSubmittedToClient(
    to:                    string,
    name:                  string,
    caseId:                string,
    inzApplicationNumber?: string,
  ): Promise<void> {
    const link = `${this.frontendUrl}/student/case`;
    await this.send({
      to,
      subject: 'Your visa application has been submitted to Immigration NZ',
      html: wrapHtml(inzSubmittedToClientBody(name, link, inzApplicationNumber), {
        heading: 'Submitted to Immigration New Zealand',
      }),
    });
    // caseId reserved for future linking — currently the client portal
    // shows the most recent case automatically.
    void caseId;
  }

  // EMAIL-MIGRATION: optional visa validity dates passed through from
  // the Phase LIA-8 visa.service.ts visa-issued path. Accepts either
  // Date or pre-formatted ISO date string — visa.service.ts has Date
  // objects in scope from the DTO. We format to YYYY-MM-DD here so
  // the template body stays string-only.
  async sendVisaIssuedToClient(
    to:             string,
    name:           string,
    caseId:         string,
    visaStartDate?: Date | string | null,
    visaEndDate?:   Date | string | null,
  ): Promise<void> {
    const link = `${this.frontendUrl}/student/case`;
    const formatDate = (d: Date | string | null | undefined): string | null => {
      if (!d) return null;
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return d;
    };
    await this.send({
      to,
      subject: 'Your visa has been issued',
      html: wrapHtml(
        visaIssuedToClientBody(name, link, formatDate(visaStartDate), formatDate(visaEndDate)),
        { heading: 'Your visa is approved' },
      ),
    });
    void caseId;
  }

  async sendVisaDeclinedToClient(
    to: string,
    name: string,
    caseId: string,
  ): Promise<void> {
    const link = `${this.frontendUrl}/student/case`;
    await this.send({
      to,
      subject: 'Update on your visa application',
      html: wrapHtml(visaDeclinedToClientBody(name, link), {
        heading: 'Update on your visa application',
      }),
    });
    void caseId;
  }

  async sendVisaExpiryReminderToLia(
    to: string,
    liaName: string,
    clientName: string,
    caseId: string,
    visaEndDate: Date,
    daysRemaining: number,
    threshold: number,
  ): Promise<void> {
    const link = `${this.frontendUrl}/lia/cases/${caseId}`;
    const endStr = visaEndDate.toISOString().slice(0, 10);
    await this.send({
      to,
      subject: `Visa expiry approaching: ${clientName} — ${threshold} days`,
      html: wrapHtml(
        visaExpiryReminderToLiaBody(liaName, clientName, endStr, daysRemaining, link),
        { heading: 'Visa expiry approaching' },
      ),
    });
  }

  async sendVisaExpiryReminderToClient(
    to: string,
    clientName: string,
    visaEndDate: Date,
    daysRemaining: number,
    threshold: number,
  ): Promise<void> {
    const link = `${this.frontendUrl}/student/case/messages`;
    const endStr = visaEndDate.toISOString().slice(0, 10);
    await this.send({
      to,
      subject: `Your visa expires in ${threshold} days — let's discuss next steps`,
      html: wrapHtml(
        visaExpiryReminderToClientBody(clientName, endStr, daysRemaining, link),
        { heading: 'Visa expiry approaching' },
      ),
    });
  }

  async sendVisaExpiryReminderToOwner(
    to: string,
    ownerName: string,
    clientName: string,
    liaName: string | null,
    caseId: string,
    visaEndDate: Date,
    daysRemaining: number,
    threshold: number,
  ): Promise<void> {
    const link = `${this.frontendUrl}/lia/cases/${caseId}`;
    const endStr = visaEndDate.toISOString().slice(0, 10);
    await this.send({
      to,
      subject: `Renewal opportunity: ${clientName} — visa expires in ${threshold} days`,
      html: wrapHtml(
        visaExpiryReminderToOwnerBody(ownerName, clientName, liaName, endStr, daysRemaining, link),
        { heading: 'Renewal opportunity' },
      ),
    });
  }

  // EMAIL-MIGRATION (NotificationsService → MailService) — payment
  // receipt sent when Stripe reports payment_intent.succeeded for a
  // consultation. Ported from the post-bugfix
  // NotificationsService.sendConsultationConfirmation
  // (subject + body match exactly; only the transport changes).
  //
  // Amount is integer cents; we format it the same way the staff
  // Payments tab does — "NZD 50.00" — so receipts and the tab agree.
  async sendConsultationConfirmation(
    to:          string,
    name:        string,
    amount:      number,
    currency:    string,
    type:        string,
    paymentRef?: string,
  ): Promise<void> {
    // PR-PAYMENTS-RECEIPT — generic receipt copy: subject + body no
    // longer name the payment "type". The `type` arg stays on the
    // signature so the webhook caller (and the future staff Payments
    // tab) don't change shape, but it's not shown to the client. The
    // receipt now reads correctly for ANY paymentType === 'consultation'
    // success — consultations, deposits, custom-amount charges.
    void type;
    const amountDisplay = `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
    await this.send({
      to,
      subject: 'Payment received — Sorena Visa',
      html: wrapHtml(
        consultationConfirmationBody(name, amountDisplay, paymentRef),
        { heading: 'Payment received' },
      ),
    });
  }

  // EMAIL-MIGRATION: thin pass-through used by the Friday client digest
  // (digest.service.ts). The digest module owns its own HTML composition
  // — render per-event sentences, build the populated/empty branch — so
  // this method takes a finished subject+html. Mirrors the same shape
  // NotificationsService.sendWeeklyDigest had so the digest call site
  // is a one-line swap.
  //
  // We do NOT swallow Resend failures here even though the rest of
  // MailService.send does — the digest layer wants to know whether the
  // send succeeded so its `{ sent }` result is truthful. Calls
  // `client.emails.send` directly rather than `this.send`, mirroring the
  // pattern the old NotificationsService.sendWeeklyDigest established.
  async sendWeeklyDigest(to: string, subject: string, html: string): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.warn(`Digest email not sent to ${to}: Resend not configured`);
      throw new Error('Resend is not configured');
    }
    try {
      const res = await this.client.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      if (res.error) {
        this.logger.error(`Resend digest send failed to=${to}: ${res.error.message}`);
        throw new Error(res.error.message);
      }
      this.logger.log(`Digest email sent to=${to} id=${res.data?.id ?? '?'}`);
    } catch (err: any) {
      this.logger.error(`Resend digest exception to=${to}: ${err?.message ?? err}`);
      throw err;
    }
  }

  // EMAIL-MIGRATION: generic public sendEmail for callers that build
  // their own subject + HTML (the admission flow does this — see
  // students/admission/admission.service.ts). Same signature as
  // EmailService.sendEmail, so call sites need only a field-rename.
  // Routes through the standard `send` path so the [MAIL MOCK] fallback
  // and the failure-swallow contract are preserved.
  async sendEmail(args: { to: string; subject: string; html: string }): Promise<void> {
    await this.send(args);
  }

  // PR-SUPPORT-1 follow-up — notification only. Body of the reply
  // stays in the portal (ticket content is encrypted; we don't
  // export plaintext into a third-party SMTP / Resend log).
  async sendTicketReplyNotification(
    to: string,
    clientName: string,
    ticketId: string,
  ): Promise<void> {
    const link = `${this.frontendUrl}/student/tickets/${ticketId}`;
    await this.send({
      to,
      subject: 'New reply on your Sorena support ticket',
      html: wrapHtml(ticketReplyNotificationBody(clientName, link), {
        heading: 'New reply on your ticket',
      }),
    });
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private async send(args: { to: string; subject: string; html: string }): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.log(`[MAIL MOCK] to=${args.to} subject=${args.subject}`);
      return;
    }
    try {
      const res = await this.client.emails.send({
        from: this.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      });
      if (res.error) {
        this.logger.error(
          `Resend send failed to=${args.to} subject="${args.subject}": ${res.error.message}`,
        );
        return;
      }
      this.logger.log(`Email sent to=${args.to} subject="${args.subject}" id=${res.data?.id ?? '?'}`);
    } catch (err: any) {
      this.logger.error(
        `Resend exception to=${args.to} subject="${args.subject}": ${err?.message ?? err}`,
      );
      // Swallow — email must never block a caller's business action.
    }
  }
}

// Escape the user's name when interpolated into the heading line. The
// templates' inner-body fragments already escape, but the heading
// option passes a raw string straight into wrapHtml, so we mirror the
// same defence here.
function escapeHeading(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
