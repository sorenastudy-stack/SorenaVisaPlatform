/**
 * Phase 6.5 — unit-mocked spec for the webhook payment.create shape.
 *
 * The existing payments.controller.spec.ts is a DB integration test that
 * boots real Prisma and seeds rows. That's the right tool for verifying
 * LIA-assignment + idempotency end-to-end, but it's heavy and depends on
 * the local DB schema being current. For the narrow Phase 6.5 concern —
 * "Stripe payments also land with verificationStatus = PENDING" — we
 * just need to drive handlePaymentSucceeded against a mocked Prisma and
 * assert the shape passed to payment.create.
 *
 * This is a unit test (no Nest boot, no real Prisma), focused on the
 * single behaviour added by Phase 6.5.
 */

import { Logger } from '@nestjs/common';
import { PaymentsController } from './payments.controller';

function makeController() {
  // Capture what handlePaymentSucceeded sends to payment.create. The
  // critical assertion is that data.verificationStatus === 'PENDING'.
  const paymentCreate = jest.fn().mockResolvedValue({ id: 'pay-new' });

  const prismaMock: any = {
    payment: { create: paymentCreate },
    lead: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lead-x',
        contact: { email: 'client@example.com', fullName: 'Test Client' },
      }),
    },
    contract: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const stripeMock:          any = {};
  const subscriptionsMock:   any = { activateSubscription: jest.fn().mockResolvedValue(undefined) };
  const eventsMock:          any = { emit:                 jest.fn().mockResolvedValue(undefined) };
  const paymentsServiceMock: any = {};
  const notificationsMock:   any = {
    sendConsultationConfirmation: jest.fn().mockResolvedValue(undefined),
    sendNewLiaAssignment:         jest.fn().mockResolvedValue(undefined),
  };
  const liaAssignmentsMock:  any = { assignLiaToCase: jest.fn() };

  const controller = new PaymentsController(
    stripeMock,
    paymentsServiceMock,
    subscriptionsMock,
    eventsMock,
    prismaMock,
    notificationsMock,
    liaAssignmentsMock,
  );

  // Silence the per-route Logger so a successful test doesn't print
  // ACCOUNT_OPENING / retry messages.
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  return { controller, prisma: prismaMock, paymentCreate, eventsMock, notificationsMock };
}

const handle = async (controller: PaymentsController, pi: unknown) => {
  await (controller as unknown as { handlePaymentSucceeded: (pi: unknown) => Promise<void> })
    .handlePaymentSucceeded(pi);
  await Promise.resolve();
};

describe('PaymentsController.handlePaymentSucceeded — Phase 6.5 verification default', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes verificationStatus: PENDING on a consultation Stripe payment', async () => {
    const { controller, paymentCreate } = makeController();

    await handle(controller, {
      id:               'pi_consult_1',
      amount_received:  5000,
      currency:         'nzd',
      metadata: {
        leadId:      'lead-x',
        paymentType: 'consultation',
        type:        'ADMISSION',
      },
    });

    expect(paymentCreate).toHaveBeenCalledTimes(1);
    const data = paymentCreate.mock.calls[0][0].data;
    expect(data.stripePaymentIntentId).toBe('pi_consult_1');
    expect(data.paymentType).toBe('consultation');
    expect(data.amount).toBe(5000);
    expect(data.status).toBe('succeeded');
    expect(data.verificationStatus).toBe('PENDING');   // ← Phase 6.5 guarantee
  });

  it('writes verificationStatus: PENDING on an ACCOUNT_OPENING Stripe payment', async () => {
    const { controller, paymentCreate } = makeController();

    await handle(controller, {
      id:               'pi_account_open_1',
      amount_received:  20000,
      currency:         'nzd',
      metadata: {
        leadId:      'lead-x',
        caseId:      'case-1',
        paymentType: 'ACCOUNT_OPENING',
      },
    });

    expect(paymentCreate).toHaveBeenCalledTimes(1);
    const data = paymentCreate.mock.calls[0][0].data;
    expect(data.stripePaymentIntentId).toBe('pi_account_open_1');
    expect(data.paymentType).toBe('ACCOUNT_OPENING');
    expect(data.caseId).toBe('case-1');
    expect(data.verificationStatus).toBe('PENDING');   // ← Phase 6.5 guarantee
  });

  it('writes verificationStatus: PENDING even for the fallback subscription branch (no paymentType in metadata)', async () => {
    const { controller, paymentCreate } = makeController();

    await handle(controller, {
      id:               'pi_sub_1',
      amount_received:  4999,
      currency:         'nzd',
      metadata: {
        leadId: 'lead-x',
        plan:   'PRO',
      },
    });

    expect(paymentCreate).toHaveBeenCalledTimes(1);
    const data = paymentCreate.mock.calls[0][0].data;
    expect(data.paymentType).toBe('unknown');           // falls through paymentType branches
    expect(data.verificationStatus).toBe('PENDING');    // still PENDING
  });
});
