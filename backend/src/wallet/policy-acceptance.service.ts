import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-WALLET slice 1 — proof-of-acceptance of the cancellation/refund policy.
//
// Bump CURRENT_POLICY_VERSION whenever the policy text changes; the version the
// client accepted is snapshotted on each row so acceptance is auditable over
// time. Captured server-side (IP + user-agent from the request) BEFORE a paid
// booking's Stripe session is created.
export const CURRENT_POLICY_VERSION = 'cancellation-refund-v1-2026-07';

@Injectable()
export class PolicyAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    userId: string;
    consultationId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    return this.prisma.policyAcceptance.create({
      data: {
        userId: params.userId,
        consultationId: params.consultationId ?? null,
        policyVersion: CURRENT_POLICY_VERSION,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
      select: { id: true, policyVersion: true, acceptedAt: true },
    });
  }
}
