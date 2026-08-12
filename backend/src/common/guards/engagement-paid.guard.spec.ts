import { ForbiddenException } from '@nestjs/common';
import { EngagementPaidGuard } from './engagement-paid.guard';

/**
 * The refusal wording, per caller.
 *
 * These controllers are mounted for STUDENT and AGENT alike, and an agent has
 * no engagement fee — telling them to wait for a payment they cannot make sends
 * them to support with a question nobody can answer. The boundary is identical
 * either way; only what the person reads changes.
 */
describe('EngagementPaidGuard — what the refusal says', () => {
  // No case, so getEngagementGateState reports unpaid and the guard refuses.
  // That is the path under test; the lookup itself is exercised elsewhere.
  const prisma: any = {
    contact: { findUnique: jest.fn().mockResolvedValue(null) },
    case: { findFirst: jest.fn().mockResolvedValue(null) },
    invoice: { findFirst: jest.fn().mockResolvedValue(null) },
    lead: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const ctx = (role: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u1', role } }) }),
    }) as any;

  const guard = new EngagementPaidGuard(prisma);

  it('tells an agent where their own portal is', async () => {
    await expect(guard.canActivate(ctx('AGENT'))).rejects.toThrow(/client area.*\/agent/i);
  });

  it('never mentions a payment to an agent', async () => {
    // The specific wrongness being fixed: an agent has no engagement fee.
    await guard.canActivate(ctx('AGENT')).catch((e: ForbiddenException) => {
      expect(e.message).not.toMatch(/payment/i);
    });
    expect.assertions(1);
  });

  it('leaves the client wording alone', async () => {
    await expect(guard.canActivate(ctx('STUDENT'))).rejects.toThrow(/confirm your payment/i);
  });

  it('refuses either way — the wording is not the boundary', async () => {
    for (const role of ['AGENT', 'STUDENT', 'LEAD']) {
      await expect(guard.canActivate(ctx(role))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
