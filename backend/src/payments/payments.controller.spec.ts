/**
 * PR-LIA-AUTO-ASSIGN Phase 7 (Option A) — payments-webhook integration spec.
 *
 * Drives PaymentsController.handlePaymentSucceeded directly (private method,
 * accessed via bracket notation) with the synthetic paymentIntent fixtures
 * from test/fixtures, against rows seeded by test/helpers/db-fixtures.
 *
 * Real Prisma. Real LiaAssignmentService. The three external-side-effect
 * services (Stripe API client, email, subscription activation) are stubbed
 * so the test stays hermetic — none of them touch the assertions we care
 * about (Payment row shape, case.liaId after the trigger, P2002 idempotency).
 *
 * Test isolation: each `it` seeds its own fixture and cleans up after.
 * Different fixtures use different paymentIntent.id stamps, so a residual
 * row from a failed test can't accidentally pass the next one.
 */

import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PaymentsController } from './payments.controller';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import {
  seedFixture,
  cleanupFixture,
  type SeededFixture,
} from '../../test/helpers/db-fixtures';
import { buildPaymentIntents } from '../../test/fixtures/payment-intents';

describe('PaymentsController.handlePaymentSucceeded (PR-LIA-AUTO-ASSIGN Phase 7)', () => {
  let controller: PaymentsController;
  let prisma: PrismaClient;

  // Spies on the stubbed external services — re-set in beforeEach so each
  // test sees a clean call history.
  let notificationsStub: { sendNewLiaAssignment: jest.Mock; sendLiaAssignmentReleased: jest.Mock };
  let subscriptionsStub: { activateSubscription: jest.Mock };
  let eventsStub: { emit: jest.Mock };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    notificationsStub = {
      sendNewLiaAssignment:      jest.fn().mockResolvedValue(undefined),
      sendLiaAssignmentReleased: jest.fn().mockResolvedValue(undefined),
    };
    subscriptionsStub = {
      activateSubscription: jest.fn().mockResolvedValue(undefined),
    };
    eventsStub = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    // Real LiaAssignmentService — constructed with the real Prisma client
    // (cast to PrismaService shape; functionally identical) and the
    // notifications stub so we don't try to send real email.
    const liaAssignments = new LiaAssignmentService(
      prisma as unknown as PrismaService,
      notificationsStub as unknown as NotificationsService,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PrismaService,         useValue: prisma },
        { provide: LiaAssignmentService,  useValue: liaAssignments },
        { provide: EventsService,         useValue: eventsStub },
        { provide: StripeService,         useValue: {} /* handler never touches Stripe SDK */ },
        { provide: PaymentsService,       useValue: {} /* unused on this path */ },
        { provide: SubscriptionsService,  useValue: subscriptionsStub },
        { provide: NotificationsService,  useValue: notificationsStub },
      ],
    }).compile();

    controller = moduleRef.get(PaymentsController);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    // Reset stub call histories so each test asserts against a clean
    // baseline. The test LIA created by seedFixture won't have been
    // emailed at this point yet.
    notificationsStub.sendNewLiaAssignment.mockClear();
    notificationsStub.sendLiaAssignmentReleased.mockClear();
    subscriptionsStub.activateSubscription.mockClear();
    eventsStub.emit.mockClear();
  });

  /**
   * Helper — call the private handler. Bracket-notation cast bypasses the
   * TS `private` check at the spec boundary. Awaits any fire-and-forget
   * email side-effects by giving the event loop one tick.
   */
  const handle = async (pi: unknown): Promise<void> => {
    await (controller as unknown as { handlePaymentSucceeded: (pi: unknown) => Promise<void> })
      .handlePaymentSucceeded(pi);
    // assignLiaToCase fires .sendNewLiaAssignment().catch() at the end —
    // a microtask. Awaiting an immediate Promise.resolve() flushes it.
    await Promise.resolve();
  };

  // ─── Test 1 — Payment row shape on ACCOUNT_OPENING ──────────────────────

  describe('test 1: prisma.payment.create writes the correct shape', () => {
    let ids: SeededFixture;
    beforeEach(async () => { ids = await seedFixture(prisma, { contractSigned: true }); });
    afterEach(async () => { await cleanupFixture(prisma, ids); });

    it('on ACCOUNT_OPENING success: row has correct id/leadId/caseId/paymentType/amount/currency/status', async () => {
      const fx = buildPaymentIntents(ids);
      await handle(fx.accountOpeningSuccess);

      const row = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: fx.accountOpeningSuccess.id },
      });
      expect(row).not.toBeNull();
      expect(row!.stripePaymentIntentId).toBe(fx.accountOpeningSuccess.id);
      expect(row!.leadId).toBe(ids.leadId);
      expect(row!.caseId).toBe(ids.caseId);
      expect(row!.paymentType).toBe('ACCOUNT_OPENING');
      expect(row!.amount).toBe(20000);
      expect(row!.currency).toBe('nzd');
      expect(row!.status).toBe('succeeded');
    });
  });

  // ─── Test 2 — Phase-4 trigger fires when contract is signed ─────────────

  describe('test 2: Phase-4 trigger fires on ACCOUNT_OPENING + signed contract', () => {
    let ids: SeededFixture;
    beforeEach(async () => { ids = await seedFixture(prisma, { contractSigned: true }); });
    afterEach(async () => { await cleanupFixture(prisma, ids); });

    it('case.liaId is populated and points at the test LIA', async () => {
      // Sanity: case starts unassigned
      const before = await prisma.case.findUnique({ where: { id: ids.caseId } });
      expect(before?.liaId).toBeNull();
      expect(before?.liaAssignedAt).toBeNull();

      const fx = buildPaymentIntents(ids);
      await handle(fx.accountOpeningSuccess);

      const after = await prisma.case.findUnique({ where: { id: ids.caseId } });
      // The test LIA was the only LIA with zero open cases at seed time,
      // so the load-balanced auto-pick lands on it (the real prod LIA
      // Sheila has 3 open cases — higher count, loses the tie-break).
      expect(after?.liaId).toBe(ids.liaUserId);
      expect(after?.liaAssignedAt).not.toBeNull();
    });
  });

  // ─── Test 3 — Trigger is suppressed when contract is unsigned ───────────

  describe('test 3: Phase-4 trigger is suppressed when contract is unsigned', () => {
    let ids: SeededFixture;
    beforeEach(async () => { ids = await seedFixture(prisma, { contractSigned: false }); });
    afterEach(async () => { await cleanupFixture(prisma, ids); });

    it('case.liaId stays null but Payment row is still written', async () => {
      const fx = buildPaymentIntents(ids);
      await handle(fx.accountOpeningSuccess);

      const after = await prisma.case.findUnique({ where: { id: ids.caseId } });
      expect(after?.liaId).toBeNull();
      expect(after?.liaAssignedAt).toBeNull();

      // Phase-6 writes the Payment row BEFORE the branching logic, so it
      // exists regardless of whether the Phase-4 trigger fires.
      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: fx.accountOpeningSuccess.id },
      });
      expect(payment).not.toBeNull();
      expect(payment!.paymentType).toBe('ACCOUNT_OPENING');
    });
  });

  // ─── Test 4 — P2002 retry is idempotent ─────────────────────────────────

  describe('test 4: P2002 retry is idempotent', () => {
    let ids: SeededFixture;
    beforeEach(async () => { ids = await seedFixture(prisma, { contractSigned: true }); });
    afterEach(async () => { await cleanupFixture(prisma, ids); });

    it('replaying the same paymentIntent.id writes exactly one row and assigns exactly once', async () => {
      const fx = buildPaymentIntents(ids);

      // First delivery
      await handle(fx.accountOpeningSuccess);
      const after1 = await prisma.case.findUnique({ where: { id: ids.caseId } });
      const liaId1 = after1?.liaId ?? null;
      const assignedAt1 = after1?.liaAssignedAt ?? null;
      expect(liaId1).toBe(ids.liaUserId);
      expect(assignedAt1).not.toBeNull();

      // Stripe retry — same id, same metadata
      await handle(fx.accountOpeningRetry);

      // Exactly one Payment row
      const rows = await prisma.payment.findMany({
        where: { stripePaymentIntentId: fx.accountOpeningSuccess.id },
      });
      expect(rows).toHaveLength(1);

      // The LIA assignment is unchanged — same user, same timestamp.
      const after2 = await prisma.case.findUnique({ where: { id: ids.caseId } });
      expect(after2?.liaId).toBe(liaId1);
      expect(after2?.liaAssignedAt?.getTime()).toBe(assignedAt1?.getTime() ?? -1);

      // Exactly one LIA_AUTO_ASSIGNED audit row for this case — proves
      // assignLiaToCase didn't run twice (or run once and short-circuit
      // on already_assigned, which doesn't write an audit row).
      const auditRows = await prisma.auditLog.findMany({
        where: { entityId: ids.caseId, eventType: 'LIA_AUTO_ASSIGNED' },
      });
      expect(auditRows).toHaveLength(1);
    });
  });
});
