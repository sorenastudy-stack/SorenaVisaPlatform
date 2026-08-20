import {
  WebinarEmailKind,
  WebinarEmailStatus,
} from '@prisma/client';
import {
  WebinarEmailLifecycleService,
  buildWebinarEmailSchedule,
} from './webinar-email-lifecycle.service';

describe('buildWebinarEmailSchedule', () => {
  const now = new Date('2026-08-20T07:00:00.000Z');

  it('queues confirmation, all three reminders, and follow-up for an early registration', () => {
    const rows = buildWebinarEmailSchedule(
      'reg-1',
      {
        startsAt: new Date('2026-08-26T07:00:00.000Z'),
        durationMin: 60,
      },
      now,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      WebinarEmailKind.CONFIRMATION,
      WebinarEmailKind.REMINDER_24H,
      WebinarEmailKind.REMINDER_1H,
      WebinarEmailKind.REMINDER_10M,
      WebinarEmailKind.SCORECARD_FOLLOWUP,
    ]);
    expect(rows[4].scheduledFor).toEqual(
      new Date('2026-08-26T08:00:00.000Z'),
    );
  });

  it('does not queue stale reminders for a late registrant', () => {
    const rows = buildWebinarEmailSchedule(
      'reg-2',
      {
        startsAt: new Date('2026-08-20T07:30:00.000Z'),
        durationMin: 60,
      },
      now,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      WebinarEmailKind.CONFIRMATION,
      WebinarEmailKind.REMINDER_10M,
      WebinarEmailKind.SCORECARD_FOLLOWUP,
    ]);
  });
});

describe('WebinarEmailLifecycleService', () => {
  const now = new Date('2026-08-20T06:00:00.000Z');

  function delivery(kind: WebinarEmailKind, overrides: Record<string, any> = {}) {
    return {
      id: `delivery-${kind}`,
      registrationId: 'reg-1',
      kind,
      status: WebinarEmailStatus.PENDING,
      attempts: 0,
      scheduledFor: now,
      nextAttemptAt: now,
      createdAt: now,
      registration: {
        id: 'reg-1',
        email: 'student@example.com',
        fullName: 'Student Name',
        webinar: {
          id: 'webinar-1',
          title: 'Study in New Zealand: Your Questions Answered',
          description: 'Free weekly webinar',
          startsAt: new Date('2026-08-26T07:00:00.000Z'),
          durationMin: 60,
          joinUrl: 'https://teams.example/join',
          status: 'SCHEDULED',
        },
      },
      ...overrides,
    };
  }

  function harness(rows: any[], claimCount = 1) {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 }) // stale-claim recovery
      .mockResolvedValue({ count: claimCount });
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = {
      webinarEmailDelivery: {
        updateMany,
        findMany: jest.fn().mockResolvedValue(rows),
        update,
      },
    };
    const mail: any = {
      sendIdempotentEmail: jest.fn().mockResolvedValue({
        sent: true,
        providerMessageId: 'resend-123',
      }),
    };
    const service = new WebinarEmailLifecycleService(prisma, mail);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    return { service, prisma, mail, updateMany, update };
  }

  it('sends a claimed confirmation and records the provider id', async () => {
    const row = delivery(WebinarEmailKind.CONFIRMATION);
    const h = harness([row]);

    const result = await h.service.dispatchDue(now);

    expect(result).toEqual({
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    expect(h.mail.sendIdempotentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.com',
        idempotencyKey: `webinar-${row.id}`,
      }),
    );
    expect(h.update).toHaveBeenLastCalledWith({
      where: { id: row.id },
      data: expect.objectContaining({
        status: WebinarEmailStatus.SENT,
        providerMessageId: 'resend-123',
        nextAttemptAt: null,
      }),
    });
  });

  it('does not send when another worker already claimed the row', async () => {
    const h = harness([delivery(WebinarEmailKind.CONFIRMATION)], 0);

    const result = await h.service.dispatchDue(now);

    expect(result.processed).toBe(0);
    expect(h.mail.sendIdempotentEmail).not.toHaveBeenCalled();
  });

  it('records a failed attempt and schedules a retry', async () => {
    const row = delivery(WebinarEmailKind.CONFIRMATION);
    const h = harness([row]);
    h.mail.sendIdempotentEmail.mockResolvedValue({
      sent: false,
      error: 'temporary provider failure',
    });

    const result = await h.service.dispatchDue(now);

    expect(result.failed).toBe(1);
    expect(h.update).toHaveBeenLastCalledWith({
      where: { id: row.id },
      data: expect.objectContaining({
        status: WebinarEmailStatus.FAILED,
        lastError: 'temporary provider failure',
        nextAttemptAt: new Date('2026-08-20T06:01:00.000Z'),
      }),
    });
  });

  it('skips a reminder whose webinar has already started', async () => {
    const row = delivery(WebinarEmailKind.REMINDER_10M, {
      registration: {
        id: 'reg-1',
        email: 'student@example.com',
        fullName: 'Student Name',
        webinar: {
          id: 'webinar-1',
          title: 'Study in New Zealand',
          description: null,
          startsAt: new Date('2026-08-20T05:59:00.000Z'),
          durationMin: 60,
          joinUrl: 'https://teams.example/join',
          status: 'LIVE',
        },
      },
    });
    const h = harness([row]);

    const result = await h.service.dispatchDue(now);

    expect(result.skipped).toBe(1);
    expect(h.mail.sendIdempotentEmail).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith({
      where: { id: row.id },
      data: expect.objectContaining({
        status: WebinarEmailStatus.SKIPPED,
        nextAttemptAt: null,
      }),
    });
  });
});
