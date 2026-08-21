/**
 * PR-WHATSAPP-SEC-1 — unit tests for WhatsappSignatureGuard: Meta's
 * X-Hub-Signature-256 (HMAC-SHA256 over the raw body, hex-encoded,
 * `sha256=` prefixed). Modeled directly on
 * `contracts/docusign-webhook.guard.spec.ts` and
 * `contracts/docuseal-webhook.guard.spec.ts`'s test shape for this codebase's
 * webhook guards.
 */

import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { WhatsappSignatureGuard } from './whatsapp-signature.guard';

const SECRET = 'test-whatsapp-app-secret-do-not-use-in-prod';

function makeCtx(headers: Record<string, unknown>, rawBody?: Buffer): any {
  const req = { headers, rawBody };
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

function signatureHeader(secret: string, rawBody: Buffer): string {
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hex}`;
}

describe('WhatsappSignatureGuard', () => {
  const body = Buffer.from(
    JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { messages: [] } }] }] }),
  );
  const ORIGINAL = process.env.WHATSAPP_APP_SECRET;
  let guard: WhatsappSignatureGuard;

  beforeEach(() => {
    guard = new WhatsappSignatureGuard();
    process.env.WHATSAPP_APP_SECRET = SECRET;
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = ORIGINAL;
  });

  it('accepts a valid X-Hub-Signature-256 header', () => {
    const ctx = makeCtx({ 'x-hub-signature-256': signatureHeader(SECRET, body) }, body);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when the header is missing', () => {
    const ctx = makeCtx({}, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const ctx = makeCtx({ 'x-hub-signature-256': signatureHeader('wrong-secret', body) }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a valid signature over a DIFFERENT (tampered) body', () => {
    const sig = signatureHeader(SECRET, body);
    const tampered = Buffer.from(JSON.stringify({ entry: [] }));
    const ctx = makeCtx({ 'x-hub-signature-256': sig }, tampered);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a header missing the sha256= prefix', () => {
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const ctx = makeCtx({ 'x-hub-signature-256': hex }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a malformed (non-hex) signature value', () => {
    const ctx = makeCtx({ 'x-hub-signature-256': 'sha256=not-hex-garbage!!' }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the raw body is unavailable (cannot verify)', () => {
    const ctx = makeCtx({ 'x-hub-signature-256': signatureHeader(SECRET, body) } /* no rawBody */);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects an empty raw body', () => {
    const ctx = makeCtx(
      { 'x-hub-signature-256': signatureHeader(SECRET, body) },
      Buffer.alloc(0),
    );
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when WHATSAPP_APP_SECRET is unset (fail closed)', () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const ctx = makeCtx({ 'x-hub-signature-256': signatureHeader(SECRET, body) }, body);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('accepts a signature header array by using its first value', () => {
    const ctx = makeCtx({ 'x-hub-signature-256': [signatureHeader(SECRET, body)] }, body);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
