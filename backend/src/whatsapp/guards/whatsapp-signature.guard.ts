import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

// PR-WHATSAPP-SEC-1 — HMAC gate in front of POST /whatsapp/webhook.
//
// Meta's WhatsApp Cloud API signs the RAW request body with HMAC-SHA256 using
// the app's secret (Meta App Dashboard → Settings → Basic → App Secret) and
// sends the result, hex-encoded and prefixed `sha256=`, in the
// `X-Hub-Signature-256` header — same mechanism as every other Meta Graph API
// webhook (Messenger, Instagram). See:
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
//
// This runs BEFORE the controller handler, so a forged POST claiming to be a
// WhatsApp message never reaches `WhatsappService.handleInboundMessage` (which
// creates Contact/Lead rows from unauthenticated input). It mirrors
// `contracts/docusign-webhook.guard.ts`'s shape exactly (same fail-closed
// rules, same reliance on Nest's global `rawBody: true` bootstrap option in
// `main.ts` to get the untouched Buffer on `req.rawBody`) — the DocuSign guard
// is the direct model for this one, adapted for Meta's single-header,
// hex-not-base64 format instead of DocuSign's numbered base64 headers.
//
// Fail closed: a missing secret, a missing raw body, a missing header, or any
// mismatch → 401. We never process a WhatsApp webhook call we cannot prove
// came from Meta.
//
// Only guards the POST (message/status callbacks). The GET verification
// challenge (`WhatsappController.verifyWebhook`) is Meta's one-time,
// low-frequency handshake authenticated by `WHATSAPP_VERIFY_TOKEN` instead —
// there is no body to sign on a GET, so this guard does not apply there.
@Injectable()
export class WhatsappSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsappSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      // Deploy misconfiguration — without the secret we cannot verify
      // anything, so we must reject rather than silently trust the caller.
      this.logger.error(
        'WHATSAPP_APP_SECRET is not set — rejecting webhook (cannot verify signature).',
      );
      throw new UnauthorizedException('Webhook signature verification unavailable');
    }

    // The HMAC must run on the exact bytes Meta hashed, not re-serialised
    // JSON. `main.ts` bootstraps Nest with `{ rawBody: true }`, so the parser
    // stashes the untouched Buffer on `req.rawBody` (same source the Stripe
    // and DocuSign webhook guards use).
    const raw: unknown = req.rawBody;
    if (!Buffer.isBuffer(raw) || raw.length === 0) {
      this.logger.error(
        'WhatsApp webhook: raw body unavailable — cannot verify HMAC. Rejecting.',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const header = req.headers?.['x-hub-signature-256'];
    const provided = typeof header === 'string'
      ? header
      : Array.isArray(header) && typeof header[0] === 'string'
        ? header[0]
        : null;

    if (!provided) {
      this.logger.warn('WhatsApp webhook: no X-Hub-Signature-256 header present. Rejecting.');
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expected = crypto.createHmac('sha256', secret).update(raw).digest();

    if (!this.timingSafeMatch(provided, expected)) {
      this.logger.warn('WhatsApp webhook: HMAC signature mismatch. Rejecting.');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }

  // Meta sends `sha256=<hex>`. Strip the prefix, decode hex, and compare the
  // raw HMAC bytes against our digest in constant time. A missing prefix or a
  // length mismatch (garbage input) can't be fed to timingSafeEqual, so both
  // short-circuit as a non-match rather than throwing.
  private timingSafeMatch(header: string, expected: Buffer): boolean {
    const trimmed = header.trim();
    if (!trimmed.startsWith('sha256=')) return false;

    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(trimmed.slice('sha256='.length), 'hex');
    } catch {
      return false;
    }
    if (providedBuf.length !== expected.length) return false;
    return crypto.timingSafeEqual(providedBuf, expected);
  }
}
