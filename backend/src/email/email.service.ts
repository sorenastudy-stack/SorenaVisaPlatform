import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (process.env.NODE_ENV === 'production' && process.env.EMAIL_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587', 10),
        secure: process.env.EMAIL_PORT === '465',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    }
  }

  async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verificationUrl = `${frontendUrl}/verify-email?token=${token}`;
    const fromAddress = process.env.EMAIL_FROM || 'Sorena Visa <noreply@sorenavisa.co.nz>';

    const subject = 'Verify your email – Sorena Visa';
    const html = this.buildHtml(name, verificationUrl);
    const text = `Hi ${name},\n\nPlease verify your email: ${verificationUrl}\n\nThis link expires in 24 hours.\n\nSorena Visa Team`;

    if (this.transporter) {
      await this.transporter.sendMail({ from: fromAddress, to, subject, html, text });
      this.logger.log(`Verification email sent to ${to}`);
    } else {
      this.logger.log(`[EMAIL MOCK] To: ${to} | URL: ${verificationUrl}`);
    }
  }

  private buildHtml(name: string, url: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:Arial,sans-serif;background:#f4f7f6;padding:40px 0;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><div style="background:#0a2342;padding:32px;text-align:center;"><h1 style="color:#12a693;margin:0;font-size:1.5rem;">Sorena<span style="color:#fff;">Visa</span></h1></div><div style="padding:40px 36px;"><h2 style="color:#0a2342;margin:0 0 16px;">Hi ${name},</h2><p style="color:#5a6a7a;line-height:1.6;margin:0 0 28px;">Thank you for reaching out! Please verify your email address to complete your enquiry.</p><a href="${url}" style="display:inline-block;background:#0d7a6e;color:#fff;text-decoration:none;padding:14px 32px;border-radius:7px;font-weight:700;font-size:1rem;">Verify My Email</a><p style="color:#5a6a7a;font-size:0.85rem;margin:28px 0 0;line-height:1.6;">This link expires in <strong>24 hours</strong>. If you did not submit an enquiry, please ignore this email.</p></div></div></body></html>`;
  }
}
