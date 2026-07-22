/**
 * PR-DOCUSEAL — unit tests for the dual-mode DocusealWebhookGuard: the existing
 * custom secret header ("Secret" mode) AND the DocuSeal HMAC signature ("HMAC"
 * mode) as a fallback. Verifies EITHER passes, and fail-closed when neither does.
 *
 * HMAC spec (from DocuSeal lib/webhook_urls/signatures.rb):
 *   header  X-Docuseal-Signature: "<ts>.<hex>"
 *   hex   = HMAC-SHA256(secret, "<ts>.<raw body>")  (hex-encoded)
 *   verify enforces a ±300s timestamp tolerance + constant-time compare.
 */

import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { DocusealWebhookGuard } from './docuseal-webhook.guard';

const SECRET = 'whsec_test_secret_abcdefghijklmnop';

function makeCtx(headers: Record<string, unknown>, rawBody?: Buffer): any {
  const req = { headers, rawBody };
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

// Build a DocuSeal-style signature header for the given body + secret.
function hmacHeader(secret: string, rawBody: Buffer, ts = Math.floor(Date.now() / 1000)): string {
  const hex = crypto.createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
  return `${ts}.${hex}`;
}

describe('DocusealWebhookGuard (Secret + HMAC dual auth)', () => {
  const body = Buffer.from(JSON.stringify({ event_type: 'submission.completed', data: { id: 1 } }));
  const ORIGINAL = process.env.DOCUSEAL_WEBHOOK_SECRET;
  let guard: DocusealWebhookGuard;

  beforeEach(() => {
    guard = new DocusealWebhookGuard();
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET;
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.DOCUSEAL_WEBHOOK_SECRET;
    else process.env.DOCUSEAL_WEBHOOK_SECRET = ORIGINAL;
  });

  it('accepts a valid custom secret header (Secret mode)', () => {
    const ctx = makeCtx({ 'x-sorena-webhook-secret': SECRET }, body);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('accepts a valid HMAC signature (HMAC mode, fallback)', () => {
    const ctx = makeCtx({ 'x-docuseal-signature': hmacHeader(SECRET, body) }, body);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when NEITHER a secret header nor an HMAC signature is present', () => {
    const ctx = makeCtx({}, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong secret header with no HMAC', () => {
    const ctx = makeCtx({ 'x-sorena-webhook-secret': 'not-the-secret' }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects an HMAC signed with the wrong secret', () => {
    const ctx = makeCtx({ 'x-docuseal-signature': hmacHeader('wrong-secret', body) }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a valid HMAC over a DIFFERENT (tampered) body', () => {
    const sig = hmacHeader(SECRET, body);
    const tampered = Buffer.from(JSON.stringify({ event_type: 'x', data: { id: 999 } }));
    const ctx = makeCtx({ 'x-docuseal-signature': sig }, tampered);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects an HMAC with a stale timestamp (outside ±300s)', () => {
    const staleTs = Math.floor(Date.now() / 1000) - 3600;
    const ctx = makeCtx({ 'x-docuseal-signature': hmacHeader(SECRET, body, staleTs) }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a malformed HMAC header (no timestamp/dot)', () => {
    const ctx = makeCtx({ 'x-docuseal-signature': 'garbage-no-dot' }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('accepts the secret header even when a bogus HMAC is also present', () => {
    const ctx = makeCtx(
      { 'x-sorena-webhook-secret': SECRET, 'x-docuseal-signature': 'garbage' },
      body,
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects HMAC when the raw body is unavailable (cannot verify)', () => {
    const ctx = makeCtx({ 'x-docuseal-signature': hmacHeader(SECRET, body) } /* no rawBody */);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when DOCUSEAL_WEBHOOK_SECRET is unset (fail closed)', () => {
    delete process.env.DOCUSEAL_WEBHOOK_SECRET;
    const ctx = makeCtx({ 'x-sorena-webhook-secret': SECRET }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
