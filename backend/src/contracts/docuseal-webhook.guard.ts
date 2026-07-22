import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

// PR-DOCUSEAL — shared-secret gate in front of POST /contracts/docuseal/webhook.
//
// DocuSeal's webhook settings let you attach a custom request header. Configure
//   X-Sorena-Webhook-Secret: <DOCUSEAL_WEBHOOK_SECRET>
// on the webhook; this guard constant-time-compares it against the env var.
//
// Fail closed: no configured secret, a missing header, or a mismatch → 401, so a
// forged/unsigned POST never reaches the state machine. This is the FIRST layer;
// the handler ADDITIONALLY re-fetches the submission from the DocuSeal API
// (authoritative) before acting on it, so a leaked secret alone cannot fabricate
// a completed submission.
@Injectable()
export class DocusealWebhookGuard implements CanActivate {
  private readonly logger = new Logger(DocusealWebhookGuard.name);
  static readonly HEADER = 'x-sorena-webhook-secret';

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error(
        'DOCUSEAL_WEBHOOK_SECRET is not set — rejecting webhook (cannot verify).',
      );
      throw new UnauthorizedException('Webhook verification unavailable');
    }

    const provided = req.headers?.[DocusealWebhookGuard.HEADER];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (typeof value !== 'string' || value.length === 0) {
      this.logger.warn('DocuSeal webhook: missing secret header. Rejecting.');
      throw new UnauthorizedException('Missing webhook secret');
    }

    const a = Buffer.from(value);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.logger.warn('DocuSeal webhook: secret mismatch. Rejecting.');
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}
