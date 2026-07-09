/**
 * PR-BOOKING-4 — unit-mocked spec for the paid-booking webhook branch.
 *
 * Mirrors payments.controller.webhook-verification.spec.ts: drives
 * handlePaymentSucceeded against a mocked Prisma (no Nest boot, no real
 * DB) and asserts the three behaviours of the `paymentType:'booking'`
 * branch — confirm-on-success, idempotent Stripe retry (P2002 early
 * return), and the paid-no-slot fallback.
 */

import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsController } from './payments.controller';

function makeController(opts: {
  consultation?: any;
  txFindFirst?: any;          // clash row or null inside the confirm tx
  paymentCreateThrowsP2002?: boolean;
}) {
  const txConsultationUpdate = jest.fn().mockResolvedValue({});
  const txConsultationFindFirst = jest.fn().mockResolvedValue(opts.txFindFirst ?? null);
  const outerConsultationUpdate = jest.fn().mockResolvedValue({});
  const consultationFindUnique = jest.fn().mockResolvedValue(opts.consultation ?? null);

  const paymentCreate = jest.fn().mockImplementation(async () => {
    if (opts.paymentCreateThrowsP2002) {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' } as any);
    }
    return { id: 'pay-new' };
  });

  const prismaMock: any = {
    payment: { create: paymentCreate },
    lead: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lead-x', contact: { email: 'c@example.com', fullName: 'Client' },
      }),
    },
    consultation: { findUnique: consultationFindUnique, update: outerConsultationUpdate },
    contract: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation(async (fn: any) =>
      fn({ consultation: { findFirst: txConsultationFindFirst, update: txConsultationUpdate } }),
    ),
  };

  const eventsMock: any = { emit: jest.fn().mockResolvedValue(undefined) };
  const bookingConfirmationMock: any = { onConfirmed: jest.fn().mockResolvedValue(undefined) };
  const controller = new PaymentsController(
    {} as any, {} as any, { activateSubscription: jest.fn() } as any, eventsMock,
    prismaMock, { sendConsultationConfirmation: jest.fn() } as any, { assignLiaToCase: jest.fn(), assignAdmissionToCase: jest.fn(), assignFinanceToCase: jest.fn() } as any,
    bookingConfirmationMock,
  );

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  return { controller, prismaMock, eventsMock, paymentCreate, consultationFindUnique, txConsultationUpdate, outerConsultationUpdate, bookingConfirmationMock };
}

const handle = (c: PaymentsController, pi: unknown) =>
  (c as any).handlePaymentSucceeded(pi);

const BOOKING_PI = {
  id: 'pi_booking_1', amount_received: 3000, currency: 'nzd',
  metadata: { leadId: 'lead-x', consultationId: 'c1', paymentType: 'booking', bookingType: 'GAP_CLOSING' },
};

describe('PaymentsController — paid booking webhook branch', () => {
  afterEach(() => jest.restoreAllMocks());

  it('confirm-on-success: flips the held consultation to CONFIRMED + PAID and emits BOOKING_CONFIRMED', async () => {
    const now = new Date();
    const { controller, txConsultationUpdate, eventsMock, bookingConfirmationMock } = makeController({
      consultation: { id: 'c1', status: 'PENDING', assignedToId: 'adv', scheduledAt: now, scheduledEndAt: now, leadId: 'lead-x' },
      txFindFirst: null,
    });

    await handle(controller, BOOKING_PI);

    expect(txConsultationUpdate).toHaveBeenCalledTimes(1);
    const data = txConsultationUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('CONFIRMED');
    expect(data.paymentStatus).toBe('PAID');
    expect(data.stripePaymentId).toBe('pi_booking_1');
    expect(data.holdExpiresAt).toBeNull();
    expect(eventsMock.emit).toHaveBeenCalledWith(
      'BOOKING_CONFIRMED', 'CONSULTATION', 'c1', 'lead-x', 'SYSTEM', null, { paymentIntentId: 'pi_booking_1' },
    );
    // PR-BOOKING-5 — finalize (Jitsi link + email) runs on the confirm path.
    expect(bookingConfirmationMock.onConfirmed).toHaveBeenCalledWith('c1');
  });

  it('idempotent retry: a P2002 on payment.create returns early — no consultation lookup/confirm', async () => {
    const { controller, consultationFindUnique } = makeController({ paymentCreateThrowsP2002: true });
    await handle(controller, BOOKING_PI);
    expect(consultationFindUnique).not.toHaveBeenCalled();
  });

  it('paid-no-slot: a clash inside the confirm tx keeps the payment, marks PAID, drops the slot, emits BOOKING_PAID_SLOT_LOST', async () => {
    const now = new Date();
    const { controller, outerConsultationUpdate, eventsMock, bookingConfirmationMock } = makeController({
      consultation: { id: 'c1', status: 'PENDING', assignedToId: 'adv', scheduledAt: now, scheduledEndAt: now, leadId: 'lead-x' },
      txFindFirst: { id: 'other-confirmed' }, // another booking took the slot
    });

    await handle(controller, BOOKING_PI);

    expect(outerConsultationUpdate).toHaveBeenCalledTimes(1);
    const data = outerConsultationUpdate.mock.calls[0][0].data;
    expect(data.paymentStatus).toBe('PAID');
    expect(data.scheduledAt).toBeNull();
    expect(data.scheduledEndAt).toBeNull();
    expect(eventsMock.emit).toHaveBeenCalledWith(
      'BOOKING_PAID_SLOT_LOST', 'CONSULTATION', 'c1', 'lead-x', 'SYSTEM', null, { paymentIntentId: 'pi_booking_1' },
    );
    // Paid-no-slot must NOT finalize (no Jitsi link / no confirmation email).
    expect(bookingConfirmationMock.onConfirmed).not.toHaveBeenCalled();
  });
});
