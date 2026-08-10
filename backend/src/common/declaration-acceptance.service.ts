import { Injectable, Logger } from '@nestjs/common';
import { DeclarationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DECLARATION_VERSION, declarationText } from './declarations';

// PR-PHASE39 — immutable proof that a client agreed to an in-form declaration.
//
// Sits alongside wallet/policy-acceptance.service.ts and writes to the SAME
// table, deliberately: the wallet path already established the right shape
// (who, when, which version, from where, on what device) and a second table
// would mean two places to look during a dispute.
//
// APPEND-ONLY. Nothing here updates or deletes. Unticking and re-ticking writes
// a second row, and both survive — the sequence is itself part of the record.
// The Boolean/timestamp on the application row keeps being the fast "is it
// currently agreed?" check and may still be overwritten; this table is what
// actually proves anything.
//
// Recording is BEST-EFFORT: a failure here is logged, never thrown. The
// alternative is an audit write taking down the form that produced it, which
// would cost more consent than it records.
@Injectable()
export class DeclarationAcceptanceService {
  private readonly logger = new Logger(DeclarationAcceptanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    userId: string;
    type: DeclarationType;
    applicationId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.policyAcceptance.create({
        data: {
          userId: params.userId,
          declarationType: params.type,
          // The server's own copy — see declarations.ts for why it is not taken
          // from the request.
          declarationText: declarationText(params.type),
          policyVersion: DECLARATION_VERSION,
          applicationId: params.applicationId ?? null,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to record ${params.type} for user ${params.userId}: ${(e as Error).message}`,
      );
    }
  }
}

/**
 * Pull the caller's IP and device from the request.
 *
 * Same derivation as booking.controller.ts: behind Railway's proxy `req.ip` is
 * the proxy, so the first hop in x-forwarded-for is the client. Kept in one
 * place so the three declaration call sites cannot drift from the wallet one.
 */
export function requestOrigin(req: any): { ipAddress: string | null; userAgent: string | null } {
  const fwd = req?.headers?.['x-forwarded-for'];
  const ipAddress =
    (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req?.ip || null;
  return { ipAddress, userAgent: req?.headers?.['user-agent'] ?? null };
}
