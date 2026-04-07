import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendWelcomeEmail(email: string, name: string): Promise<void> {
    const subject = 'Welcome to Sorena Visa - Your Study Abroad Journey Begins!';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Sorena Visa, ${name}!</h2>
        <p>Thank you for choosing Sorena Visa for your study abroad journey. We're excited to help you achieve your dreams of studying in New Zealand.</p>
        <p>Our team will be in touch soon to guide you through the next steps.</p>
        <p>Best regards,<br>The Sorena Visa Team</p>
      </div>
    `;

    await this.sendEmail(email, subject, html);
  }

  async sendConsultationConfirmation(email: string, name: string, date: string, type: string): Promise<void> {
    const subject = `Consultation Confirmed - ${type} Consultation`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Consultation Confirmed</h2>
        <p>Hi ${name},</p>
        <p>Your ${type} consultation has been confirmed for:</p>
        <p><strong>${date}</strong></p>
        <p>Please join the meeting on time. If you need to reschedule, contact us at least 24 hours in advance.</p>
        <p>Best regards,<br>The Sorena Visa Team</p>
      </div>
    `;

    await this.sendEmail(email, subject, html);
  }

  async sendDocumentRequest(email: string, name: string, documentType: string): Promise<void> {
    const subject = `Document Request - ${documentType} Required`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Document Request</h2>
        <p>Hi ${name},</p>
        <p>We need you to provide the following document:</p>
        <p><strong>${documentType}</strong></p>
        <p>Please upload this document through your dashboard as soon as possible to continue with your application.</p>
        <p>Best regards,<br>The Sorena Visa Team</p>
      </div>
    `;

    await this.sendEmail(email, subject, html);
  }

  async sendContractReady(email: string, name: string, signingUrl: string): Promise<void> {
    const subject = 'Your Contract is Ready for Signing';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Contract Ready for Signing</h2>
        <p>Hi ${name},</p>
        <p>Your contract is now ready for electronic signing. Please click the link below to review and sign your contract:</p>
        <p><a href="${signingUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Sign Contract</a></p>
        <p>This link will expire in 30 days.</p>
        <p>Best regards,<br>The Sorena Visa Team</p>
      </div>
    `;

    await this.sendEmail(email, subject, html);
  }

  async sendVisaDecision(email: string, name: string, decision: string): Promise<void> {
    const subject = `Visa Decision - ${decision}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Visa Decision Notification</h2>
        <p>Hi ${name},</p>
        <p>We have an update on your visa application:</p>
        <p><strong>Decision: ${decision}</strong></p>
        <p>Our team will contact you shortly with next steps.</p>
        <p>Best regards,<br>The Sorena Visa Team</p>
      </div>
    `;

    await this.sendEmail(email, subject, html);
  }

  async sendCommencementConfirmed(email: string, name: string, provider: string): Promise<void> {
    const subject = 'Commencement Confirmed - Welcome to Your Studies!';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Commencement Confirmed</h2>
        <p>Hi ${name},</p>
        <p>Congratulations! Your commencement at ${provider} has been confirmed.</p>
        <p>Welcome to your study abroad journey in New Zealand. We're here to support you every step of the way.</p>
        <p>Best regards,<br>The Sorena Visa Team</p>
      </div>
    `;

    await this.sendEmail(email, subject, html);
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }
}