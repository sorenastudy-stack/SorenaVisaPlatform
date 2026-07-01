import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { getSessionConfig, BookingSessionType } from './session-config';
import { buildJitsiUrl } from './meeting-link';

// PR-BOOKING-5 — shared confirm-finalize step for ALL booking types
// (FREE_15 / GAP_CLOSING / LIA). Called AFTER the booking is already
// confirmed in the DB (free: createFreeBooking; paid: the webhook). It:
//   1. generates + stores a unique Jitsi meeting link (once), then
//   2. emails the client a confirmation with the link.
//
// In its own module (not BookingModule) so PaymentsModule can import it
// without the BookingModule ⇄ PaymentsModule cycle (BookingModule already
// imports PaymentsModule for StripeService).
//
// Best-effort + idempotent: it never throws out of the confirm path, and
// `meetingLink` presence is the idempotency guard so webhook retries don't
// re-generate the link or re-email.

@Injectable()
export class BookingConfirmationService {
  private readonly logger = new Logger(BookingConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async onConfirmed(consultationId: string): Promise<void> {
    try {
      const c = await this.prisma.consultation.findUnique({
        where: { id: consultationId },
        select: {
          id: true, type: true, scheduledAt: true, bookingTimezone: true, meetingLink: true,
          assignedTo: { select: { name: true } },
          lead: { select: { contact: { select: { fullName: true, user: { select: { email: true, name: true } } } } } },
        },
      });
      if (!c) {
        this.logger.warn(`onConfirmed: consultation ${consultationId} not found`);
        return;
      }
      // Idempotency guard: already finalized (link generated + emailed).
      if (c.meetingLink) return;

      // 1. Generate + store the Jitsi link (string-building; won't fail).
      //    Includes a friendly meeting title per session type.
      const meetingLink = buildJitsiUrl(consultationId, c.type);
      await this.prisma.consultation.update({
        where: { id: consultationId },
        data: { meetingLink },
      });

      // 2. Email the client (best-effort — MailService swallows failures).
      const clientEmail = c.lead?.contact?.user?.email ?? null;
      const clientName = c.lead?.contact?.fullName || c.lead?.contact?.user?.name || 'there';
      const staffName = c.assignedTo?.name || 'your adviser';
      const sessionLabel = getSessionConfig(c.type as BookingSessionType).label;
      const whenStr = this.formatWhen(c.scheduledAt, c.bookingTimezone);

      if (clientEmail) {
        await this.mail.sendBookingConfirmation(clientEmail, clientName, sessionLabel, whenStr, staffName, meetingLink);
      } else {
        this.logger.warn(`onConfirmed: no client email for consultation ${consultationId} — link generated, email skipped`);
      }
    } catch (e: any) {
      // NEVER throw — a confirmed/paid booking must stand regardless.
      this.logger.error(`onConfirmed failed for ${consultationId}: ${e?.message ?? e}`);
    }
  }

  /** "Wednesday, 1 July at 9:00 AM (New Zealand time)" in the booking tz. */
  private formatWhen(scheduledAt: Date | null, timezone: string | null): string {
    if (!scheduledAt) return 'a time to be confirmed';
    const tz = timezone || 'Pacific/Auckland';
    const date = new Intl.DateTimeFormat('en-NZ', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(scheduledAt);
    const time = new Intl.DateTimeFormat('en-NZ', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(scheduledAt);
    // Client-local timezone is a later feature — show NZ time for now.
    return `${date} at ${time} (New Zealand time)`;
  }
}
