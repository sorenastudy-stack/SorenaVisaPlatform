import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

// PR-DOCUSEAL — authentication gate in front of POST /contracts/docuseal/webhook.
//
// DocuSeal's Webhooks settings offer two verification modes; this guard accepts
// EITHER so a misconfiguration of one doesn't take deliveries down:
//
//   1. "Secret" mode — DocuSeal sends a custom request header. We configure it
//      as  X-Sorena-Webhook-Secret: <DOCUSEAL_WEBHOOK_SECRET>  and constant-time
//      compare. (The active mode today.)
//
//   2. "HMAC" mode — DocuSeal signs the payload and sends
//        X-Docuseal-Signature: "<timestamp>.<hex HMAC-SHA256>"
//      where the digest is  HMAC-SHA256(secret, "<timestamp>.<raw body>")  and
//      the key is the same DOCUSEAL_WEBHOOK_SECRET. Verified per DocuSeal's own
//      spec (lib/webhook_urls/signatures.rb): a ±300s timestamp tolerance +
//      constant-time compare of the hex digests.
//
// Fail closed: if NEITHER check passes, reject with a precise warning so the
// failing mode is obvious in the logs. The handler ALSO re-fetches the
// submission from the DocuSeal API (authoritative) before acting on it.
@Injectable()
export class DocusealWebhookGuard implements CanActivate {
  private readonly logger = new Logger(DocusealWebhookGuard.name);

  static readonly SECRET_HEADER = 'x-sorena-webhook-secret';
  static readonly HMAC_HEADER = 'x-docuseal-signature';
  // Matches DocuSeal's WebhookUrls::Signatures::TOLERANCE (5 minutes).
  static readonly HMAC_TOLERANCE_SECONDS = 5 * 60;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error(
        'DOCUSEAL_WEBHOOK_SECRET is not set — rejecting webhook (cannot verify).',
      );
      throw new UnauthorizedException('Webhook verification unavailable');
    }

    // Method 1 — custom secret header ("Secret" mode). Unchanged behaviour.
    const secretResult = this.checkSecretHeader(req, secret);
    if (secretResult === 'match') return true;

    // Method 2 — HMAC signature ("HMAC" mode), the fallback.
    const hmacResult = this.checkHmacSignature(req, secret);
    if (hmacResult === 'valid') return true;

    // Neither passed — fail closed with a reason that names the failing mode(s).
    if (secretResult === 'mismatch') {
      this.logger.warn('DocuSeal webhook: secret header present but did not match.');
    }
    if (hmacResult === 'invalid') {
      this.logger.warn('DocuSeal webhook: HMAC signature present but failed verification.');
    }
    if (secretResult === 'absent' && hmacResult === 'absent') {
      this.logger.warn(
        'DocuSeal webhook: no authentication present — neither the X-Sorena-Webhook-Secret header nor an X-Docuseal-Signature HMAC. Rejecting.',
      );
    }
    throw new UnauthorizedException('Invalid or missing webhook authentication');
  }

  // 'match' | 'mismatch' | 'absent'
  private checkSecretHeader(req: any, secret: string): 'match' | 'mismatch' | 'absent' {
    const provided = req.headers?.[DocusealWebhookGuard.SECRET_HEADER];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (typeof value !== 'string' || value.length === 0) return 'absent';
    const a = Buffer.from(value);
    const b = Buffer.from(secret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return 'match';
    return 'mismatch';
  }

  // 'valid' | 'invalid' | 'absent'
  private checkHmacSignature(req: any, secret: string): 'valid' | 'invalid' | 'absent' {
    const provided = req.headers?.[DocusealWebhookGuard.HMAC_HEADER];
    const header = Array.isArray(provided) ? provided[0] : provided;
    if (typeof header !== 'string' || header.length === 0) return 'absent';

    // Format: "<timestamp>.<hex digest>" (split on the FIRST dot only).
    const dot = header.indexOf('.');
    if (dot <= 0) return 'invalid';
    const tsPart = header.slice(0, dot);
    const sig = header.slice(dot + 1);
    const ts = Number.parseInt(tsPart, 10);
    if (!Number.isInteger(ts) || sig.length === 0) return 'invalid';

    // Replay window — reject stale / future timestamps (matches DocuSeal).
    const now = Math.floor(Date.now() / 1000);
    if (
      ts < now - DocusealWebhookGuard.HMAC_TOLERANCE_SECONDS ||
      ts > now + DocusealWebhookGuard.HMAC_TOLERANCE_SECONDS
    ) {
      this.logger.warn('DocuSeal webhook: HMAC timestamp outside the ±300s tolerance.');
      return 'invalid';
    }

    // The HMAC must be over the exact bytes DocuSeal hashed, not re-serialised
    // JSON. main.ts bootstraps with { rawBody: true }, so req.rawBody is the
    // untouched Buffer (same source the DocuSign guard uses).
    const raw: unknown = req.rawBody;
    if (!Buffer.isBuffer(raw) || raw.length === 0) {
      this.logger.warn('DocuSeal webhook: raw body unavailable — cannot verify HMAC.');
      return 'invalid';
    }

    // expected = HMAC-SHA256(secret, "<ts>." + rawBody) as hex.
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.`)
      .update(raw)
      .digest('hex');

    // Constant-time compare of the two hex digests (equal length by construction;
    // guard against a malformed provided signature that isn't the right length).
    const expectedBuf = Buffer.from(expected, 'hex');
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(sig, 'hex');
    } catch {
      return 'invalid';
    }
    if (providedBuf.length !== expectedBuf.length) return 'invalid';
    return crypto.timingSafeEqual(providedBuf, expectedBuf) ? 'valid' : 'invalid';
  }
}
