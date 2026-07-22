/**
 * PR-BOOKING-STAFF-NOTIFY — unit tests for BookingConfirmationService.onConfirmed.
 *
 * Proves the assigned staff member is notified (the bug: they weren't), that the
 * meetingLink idempotency guard suppresses re-notification, and that a missing
 * staff email is skipped without breaking the client confirmation. Real
 * pure helpers (buildJitsiUrl / getSessionConfig); prisma + mail are mocked.
 */

import { BookingConfirmationService } from './booking-confirmation.service';

function makeConsultation(overrides: any = {}) {
  return {
    id: 'consult-1',
    type: 'LIA',
    scheduledAt: new Date('2026-07-01T21:00:00.000Z'),
    bookingTimezone: 'Pacific/Auckland',
    meetingLink: null,
    assignedTo: { name: 'Aydin Tashvighi', email: 'aydin@sorenavisa.com' },
    lead: { contact: { fullName: 'Haniyeh', user: { email: 'haniyeh@example.com', name: 'Haniyeh' } } },
    ...overrides,
  };
}

function makeMocks(consultation: any) {
  const prisma: any = {
    consultation: {
      findUnique: jest.fn().mockResolvedValue(consultation),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const mail: any = {
    sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
    sendStaffBookingNotification: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BookingConfirmationService(prisma, mail);
  return { service, prisma, mail };
}

describe('BookingConfirmationService.onConfirmed — staff notification', () => {
  it('emails the assigned staff member with the client name, when, and Jitsi link', async () => {
    const { service, mail } = makeMocks(makeConsultation());

    await service.onConfirmed('consult-1');

    expect(mail.sendStaffBookingNotification).toHaveBeenCalledTimes(1);
    const [to, staffName, clientName, sessionLabel, whenStr, meetingLink] =
      mail.sendStaffBookingNotification.mock.calls[0];
    expect(to).toBe('aydin@sorenavisa.com');       // the booked staff member's email
    expect(staffName).toBe('Aydin Tashvighi');
    expect(clientName).toBe('Haniyeh');            // who booked
    expect(sessionLabel).toBe('LIA Consultation');
    expect(whenStr).toContain('New Zealand time'); // formatted date/time
    expect(typeof meetingLink).toBe('string');
    expect(meetingLink).toContain('consult-1');    // the same Jitsi link the client gets
    // the client is still notified too
    expect(mail.sendBookingConfirmation).toHaveBeenCalledTimes(1);
    // both got the SAME meeting link
    expect(mail.sendBookingConfirmation.mock.calls[0][5]).toBe(meetingLink);
  });

  it('is idempotent: does not re-notify when the meetingLink is already set', async () => {
    const { service, mail } = makeMocks(makeConsultation({ meetingLink: 'https://meet.example/existing' }));

    await service.onConfirmed('consult-1');

    expect(mail.sendStaffBookingNotification).not.toHaveBeenCalled();
    expect(mail.sendBookingConfirmation).not.toHaveBeenCalled();
  });

  it('skips the staff email (but still emails the client) when the staff has no email', async () => {
    const { service, mail } = makeMocks(
      makeConsultation({ assignedTo: { name: 'Aydin Tashvighi', email: null } }),
    );

    await service.onConfirmed('consult-1');

    expect(mail.sendStaffBookingNotification).not.toHaveBeenCalled();
    expect(mail.sendBookingConfirmation).toHaveBeenCalledTimes(1);
  });
});
