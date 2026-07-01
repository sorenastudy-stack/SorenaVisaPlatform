import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

// PR-DOCUSIGN-N (webhook signature) — HMAC gate in front of
// POST /contracts/webhook.
//
// DocuSign Connect signs the RAW request body with HMAC-SHA256 using the
// Connect HMAC key (DocuSign Admin → Connect → Keys) and sends the result,
// base64-encoded, in the `X-DocuSign-Signature-1` header. When more than one
// HMAC key is active (key rotation) it sends one header per key:
// `X-DocuSign-Signature-1`, `-2`, … We accept the request if ANY of the
// provided signatures matches our configured key.
//
// This runs BEFORE the controller handler, so an unsigned / forged POST never
// reaches the state machine. It is the ONLY auth on the webhook route (DocuSign
// sends no JWT); the two staff-facing routes keep JwtAuthGuard + RolesGuard.
//
// Fail closed: a missing key, a missing raw body, a missing header, or any
// mismatch → 401. We never process an event we cannot prove came from DocuSign.
@Injectable()
export class DocusignWebhookGuard implements CanActivate {
  private readonly logger = new Logger(DocusignWebhookGuard.name);

  // Highest `-N` suffix DocuSign realistically emits; bounds the header scan.
  private static readonly MAX_SIGNATURE_HEADERS = 10;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const secret = process.env.DOCUSIGN_CONNECT_HMAC_KEY;
    if (!secret) {
      // Deploy misconfiguration — without the key we cannot verify anything,
      // so we must reject rather than silently trust the caller.
      this.logger.error(
        'DOCUSIGN_CONNECT_HMAC_KEY is not set — rejecting webhook (cannot verify signature).',
      );
      throw new UnauthorizedException('Webhook signature verification unavailable');
    }

    // The HMAC must run on the exact bytes DocuSign hashed, not re-serialised
    // JSON. `main.ts` bootstraps Nest with `{ rawBody: true }`, so the parser
    // stashes the untouched Buffer on `req.rawBody` (same source the Stripe
    // webhook uses).
    const raw: unknown = req.rawBody;
    if (!Buffer.isBuffer(raw) || raw.length === 0) {
      this.logger.error(
        'DocuSign webhook: raw body unavailable — cannot verify HMAC. Rejecting.',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const provided = this.collectSignatures(req.headers);
    if (provided.length === 0) {
      this.logger.warn(
        'DocuSign webhook: no X-DocuSign-Signature-* header present. Rejecting.',
      );
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expected = crypto.createHmac('sha256', secret).update(raw).digest();

    const matches = provided.some((sig) => this.timingSafeMatch(sig, expected));
    if (!matches) {
      this.logger.warn('DocuSign webhook: HMAC signature mismatch. Rejecting.');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }

  // Node lowercases incoming header names. Collect X-DocuSign-Signature-1..N.
  private collectSignatures(headers: Record<string, string | string[] | undefined>): string[] {
    const out: string[] = [];
    for (let i = 1; i <= DocusignWebhookGuard.MAX_SIGNATURE_HEADERS; i++) {
      const v = headers[`x-docusign-signature-${i}`];
      if (typeof v === 'string' && v.length > 0) out.push(v);
      else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') out.push(v[0]);
    }
    return out;
  }

  // Constant-time comparison. DocuSign sends the signature base64-encoded;
  // decode it and compare the raw HMAC bytes against our digest. A length
  // mismatch (e.g. garbage input) can't be fed to timingSafeEqual, so we
  // short-circuit it as a non-match.
  private timingSafeMatch(providedB64: string, expected: Buffer): boolean {
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(providedB64.trim(), 'base64');
    } catch {
      return false;
    }
    if (providedBuf.length !== expected.length) return false;
    return crypto.timingSafeEqual(providedBuf, expected);
  }
}
