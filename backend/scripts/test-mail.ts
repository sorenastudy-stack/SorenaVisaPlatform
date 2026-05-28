/* eslint-disable no-console */
/**
 * Throwaway smoke test for MailService — sends a real welcome email
 * through Resend (or mock-logs it if RESEND_API_KEY is missing).
 *
 * Usage:
 *   npm run test:mail -- you@example.com
 *
 * It boots a Nest application context so MailService receives its
 * normal env-driven config from .env, attaches a tiny log-capturer
 * that watches for the "Email sent" line MailService emits on
 * success, and prints the Resend response id if one comes back.
 * Closes the context when done.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { LoggerService } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';

// ─── Tiny logger that captures lines + still prints them ─────────

class CapturingLogger implements LoggerService {
  public readonly lines: string[] = [];

  log(message: any, context?: string)   { this.write('LOG',   message, context); }
  error(message: any, trace?: string, context?: string) { this.write('ERROR', message, context); if (trace) process.stderr.write(`${trace}\n`); }
  warn(message: any, context?: string)  { this.write('WARN',  message, context); }
  debug(message: any, context?: string) { this.write('DEBUG', message, context); }
  verbose(message: any, context?: string) { this.write('VERB',  message, context); }

  private write(level: string, message: any, context?: string) {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    const line = `[${level}]${context ? ` [${context}]` : ''} ${text}`;
    this.lines.push(line);
    process.stdout.write(`${line}\n`);
  }
}

async function main() {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error('Usage: npm run test:mail -- <recipient-email>');
    console.error('Example: npm run test:mail -- you@example.com');
    process.exit(1);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mail smoke test — sending welcome email to ${recipient}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Inferred from env. The actual switch lives inside MailService;
  // this is just so the operator sees the expectation up front.
  const apiKeySet = !!process.env.RESEND_API_KEY;
  console.log(`RESEND_API_KEY:  ${apiKeySet ? 'SET   → expect real send via Resend' : 'NOT SET → expect [MAIL MOCK] fallback'}`);
  console.log(`EMAIL_FROM:      ${process.env.EMAIL_FROM ?? '(unset, will default)'}`);
  console.log(`FRONTEND_URL:    ${process.env.FRONTEND_URL ?? '(unset, will default to http://localhost:3000)'}`);
  console.log('');

  const logger = new CapturingLogger();
  const app = await NestFactory.createApplicationContext(AppModule, { logger });
  const mail = app.get(MailService);

  console.log('');
  console.log('— calling mailService.sendWelcomeEmail() —');
  await mail.sendWelcomeEmail(recipient, 'Yashua');
  console.log('— call returned without throwing —');
  console.log('');

  // Scan captured log lines for either the success ("id=...") or the
  // mock-mode marker so we report unambiguously.
  const mockHit  = logger.lines.find((l) => l.includes('[MAIL MOCK]'));
  const sentHit  = logger.lines.find((l) => l.includes('Email sent to='));
  const errorHit = logger.lines.find((l) => l.includes('Resend send failed') || l.includes('Resend exception'));

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Result');
  console.log('═══════════════════════════════════════════════════════════════');
  if (mockHit) {
    console.log('MODE: mock (no real email sent)');
    console.log(`  → ${mockHit}`);
  } else if (errorHit) {
    console.log('MODE: real Resend call but DELIVERY FAILED');
    console.log(`  → ${errorHit}`);
    console.log('  (MailService swallows the throw — see the error log above)');
  } else if (sentHit) {
    console.log('MODE: real send via Resend — delivered');
    const idMatch = sentHit.match(/id=(\S+)/);
    console.log(`  Resend response id: ${idMatch ? idMatch[1] : '(could not parse)'}`);
    console.log(`  → ${sentHit}`);
  } else {
    console.log('MODE: unknown — no MailService log line captured');
    console.log('  (something is unusual; inspect the raw log lines above)');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  await app.close();
}

main().catch((err) => {
  console.error('[test-mail] fatal:', err);
  process.exit(1);
});
