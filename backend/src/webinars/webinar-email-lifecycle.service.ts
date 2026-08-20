import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  Prisma,
  WebinarEmailKind,
  WebinarEmailStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  wrapHtml,
  webinarConfirmationBody,
  webinarReminderBody,
  webinarScorecardFollowupBody,
  type WebinarEmailTemplateData,
} from '../mail/mail.templates';

const MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 10 * 60_000;
const WEBINAR_RECIPIENT_REASON =
  "You're receiving this because you registered for a Sorena Visa webinar.";

const REMINDER_OFFSETS: ReadonlyArray<{
  kind: WebinarEmailKind;
  milliseconds: number;
}> = [
  { kind: WebinarEmailKind.REMINDER_24H, milliseconds: 24 * 60 * 60_000 },
  { kind: WebinarEmailKind.REMINDER_1H, milliseconds: 60 * 60_000 },
  { kind: WebinarEmailKind.REMINDER_10M, milliseconds: 10 * 60_000 },
];

type SchedulableWebinar = {
  startsAt: Date;
  durationMin: number;
};

export function buildWebinarEmailSchedule(
  registrationId: string,
  webinar: SchedulableWebinar,
  now: Date = new Date(),
): Prisma.WebinarEmailDeliveryCreateManyInput[] {
  const rows: Prisma.WebinarEmailDeliveryCreateManyInput[] = [
    {
      registrationId,
      kind: WebinarEmailKind.CONFIRMATION,
      scheduledFor: now,
      nextAttemptAt: now,
    },
  ];

  for (const reminder of REMINDER_OFFSETS) {
    const scheduledFor = new Date(
      webinar.startsAt.getTime() - reminder.milliseconds,
    );
    // A late registrant receives only reminders that are still genuinely useful.
    // This prevents 24h/1h/10m messages all firing together after their window.
    if (scheduledFor.getTime() > now.getTime()) {
      rows.push({
        registrationId,
        kind: reminder.kind,
        scheduledFor,
        nextAttemptAt: scheduledFor,
      });
    }
  }

  const followupAt = new Date(
    webinar.startsAt.getTime() + webinar.durationMin * 60_000,
  );
  rows.push({
    registrationId,
    kind: WebinarEmailKind.SCORECARD_FOLLOWUP,
    scheduledFor: followupAt,
    nextAttemptAt: followupAt,
  });

  return rows;
}

@Injectable()
export class WebinarEmailLifecycleService {
  private readonly logger = new Logger(WebinarEmailLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron('* * * * *', {
    name: 'webinarEmailLifecycle',
    timeZone: 'UTC',
  })
  async handleCron(): Promise<void> {
    try {
      const result = await this.dispatchDue();
      if (result.processed > 0) {
        this.logger.log(
          `[webinar-email] processed=${result.processed} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[webinar-email] sweep crashed: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  /** Attempt the just-created confirmation immediately.
   * Failure never unwinds registration: the FAILED ledger row is retried by cron.
   */
  async dispatchDueForRegistration(
    registrationId: string,
    now: Date = new Date(),
  ) {
    return this.dispatchDue(now, registrationId, 10);
  }

  async dispatchDue(
    now: Date = new Date(),
    registrationId?: string,
    take = 100,
  ): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
    // A process can stop between claiming a row and recording the provider result.
    // Recover old claims; the Resend idempotency key prevents a duplicate provider
    // send if the first attempt actually reached Resend before the crash.
    const staleBefore = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
    await this.prisma.webinarEmailDelivery.updateMany({
      where: {
        status: WebinarEmailStatus.PROCESSING,
        lastAttemptAt: { lt: staleBefore },
        ...(registrationId ? { registrationId } : {}),
      },
      data: {
        status: WebinarEmailStatus.FAILED,
        nextAttemptAt: now,
        lastError: 'Recovered stale processing claim',
      },
    });

    const deliveries = await this.prisma.webinarEmailDelivery.findMany({
      where: {
        ...(registrationId ? { registrationId } : {}),
        status: {
          in: [WebinarEmailStatus.PENDING, WebinarEmailStatus.FAILED],
        },
        attempts: { lt: MAX_ATTEMPTS },
        nextAttemptAt: { lte: now },
      },
      include: {
        registration: {
          include: { webinar: true },
        },
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
      take,
    });

    const result = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    for (const delivery of deliveries) {
      const claimed = await this.prisma.webinarEmailDelivery.updateMany({
        where: {
          id: delivery.id,
          status: {
            in: [WebinarEmailStatus.PENDING, WebinarEmailStatus.FAILED],
          },
          attempts: { lt: MAX_ATTEMPTS },
        },
        data: {
          status: WebinarEmailStatus.PROCESSING,
          attempts: { increment: 1 },
          lastAttemptAt: now,
          lastError: null,
        },
      });
      if (claimed.count !== 1) continue;

      result.processed++;
      const attempt = delivery.attempts + 1;
      const webinar = delivery.registration.webinar;
      const endsAt = new Date(
        webinar.startsAt.getTime() + webinar.durationMin * 60_000,
      );

      if (
        webinar.status === 'CANCELLED' ||
        (delivery.kind === WebinarEmailKind.CONFIRMATION &&
          endsAt.getTime() <= now.getTime()) ||
        (isReminder(delivery.kind) &&
          webinar.startsAt.getTime() <= now.getTime())
      ) {
        await this.markSkipped(
          delivery.id,
          webinar.status === 'CANCELLED'
            ? 'Webinar cancelled'
            : 'Lifecycle window has passed',
          now,
        );
        result.skipped++;
        continue;
      }

      const message = this.buildMessage(delivery);
      if (!message) {
        await this.markFailed(
          delivery.id,
          attempt,
          'Missing webinar join URL',
          now,
        );
        result.failed++;
        continue;
      }

      const sent = await this.mail.sendIdempotentEmail({
        to: delivery.registration.email,
        subject: message.subject,
        html: message.html,
        // Stable across retries and short enough for Resend's 256-char limit.
        idempotencyKey: `webinar-${delivery.id}`,
      });

      if (sent.sent) {
        await this.prisma.webinarEmailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: WebinarEmailStatus.SENT,
            sentAt: now,
            nextAttemptAt: null,
            providerMessageId: sent.providerMessageId ?? null,
            lastError: null,
          },
        });
        result.sent++;
      } else {
        await this.markFailed(
          delivery.id,
          attempt,
          sent.error ?? 'Unknown email provider error',
          now,
        );
        result.failed++;
      }
    }

    return result;
  }

  private buildMessage(delivery: any): { subject: string; html: string } | null {
    const webinar = delivery.registration.webinar;
    const isScorecard =
      delivery.kind === WebinarEmailKind.SCORECARD_FOLLOWUP;

    if (!isScorecard && !webinar.joinUrl) return null;

    const data: WebinarEmailTemplateData = {
      name: delivery.registration.fullName,
      title: webinar.title,
      whenLabel: formatAucklandDate(webinar.startsAt),
      durationMin: webinar.durationMin,
      joinUrl: webinar.joinUrl,
      calendarUrl: webinar.joinUrl
        ? buildGoogleCalendarUrl(webinar)
        : null,
      scorecardUrl: scorecardUrl(),
    };

    switch (delivery.kind as WebinarEmailKind) {
      case WebinarEmailKind.CONFIRMATION:
        return {
          subject: 'Your webinar seat is reserved — Sorena Visa',
          html: wrapHtml(webinarConfirmationBody(data), {
            heading: 'Your seat is reserved',
            recipientReason: WEBINAR_RECIPIENT_REASON,
          }),
        };
      case WebinarEmailKind.REMINDER_24H:
        return {
          subject: `Tomorrow: ${webinar.title}`,
          html: wrapHtml(webinarReminderBody(data, 'tomorrow'), {
            heading: 'Your webinar is tomorrow',
            recipientReason: WEBINAR_RECIPIENT_REASON,
          }),
        };
      case WebinarEmailKind.REMINDER_1H:
        return {
          subject: `Starting in 1 hour: ${webinar.title}`,
          html: wrapHtml(webinarReminderBody(data, 'in 1 hour'), {
            heading: 'Starting in one hour',
            recipientReason: WEBINAR_RECIPIENT_REASON,
          }),
        };
      case WebinarEmailKind.REMINDER_10M:
        return {
          subject: `Starting in 10 minutes: ${webinar.title}`,
          html: wrapHtml(webinarReminderBody(data, 'in 10 minutes'), {
            heading: 'We start in ten minutes',
            recipientReason: WEBINAR_RECIPIENT_REASON,
          }),
        };
      case WebinarEmailKind.SCORECARD_FOLLOWUP:
        return {
          subject: 'Your Sorena Scorecard invitation',
          html: wrapHtml(webinarScorecardFollowupBody(data), {
            heading: 'Your next step',
            recipientReason: WEBINAR_RECIPIENT_REASON,
          }),
        };
      default:
        return null;
    }
  }

  private async markSkipped(
    id: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.webinarEmailDelivery.update({
      where: { id },
      data: {
        status: WebinarEmailStatus.SKIPPED,
        nextAttemptAt: null,
        lastError: reason,
        lastAttemptAt: now,
      },
    });
  }

  private async markFailed(
    id: string,
    attempt: number,
    error: string,
    now: Date,
  ): Promise<void> {
    const retryAt =
      attempt >= MAX_ATTEMPTS
        ? null
        : new Date(now.getTime() + retryDelayMs(attempt));

    await this.prisma.webinarEmailDelivery.update({
      where: { id },
      data: {
        status: WebinarEmailStatus.FAILED,
        nextAttemptAt: retryAt,
        lastError: String(error).slice(0, 2_000),
      },
    });
  }
}

function isReminder(kind: WebinarEmailKind): boolean {
  return (
    kind === WebinarEmailKind.REMINDER_24H ||
    kind === WebinarEmailKind.REMINDER_1H ||
    kind === WebinarEmailKind.REMINDER_10M
  );
}

function retryDelayMs(attempt: number): number {
  const minutes = [1, 5, 15, 60];
  return minutes[Math.min(Math.max(attempt - 1, 0), minutes.length - 1)] * 60_000;
}

function formatAucklandDate(date: Date): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function scorecardUrl(): string {
  if (process.env.SCORECARD_URL) return process.env.SCORECARD_URL;
  const base = (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    'https://app.sorenavisa.com'
  ).replace(/\/+$/, '');
  return `${base}/scorecard?utm_source=webinar&utm_medium=email&utm_campaign=scorecard_followup`;
}

function buildGoogleCalendarUrl(webinar: {
  title: string;
  description: string | null;
  startsAt: Date;
  durationMin: number;
  joinUrl: string | null;
}): string {
  const end = new Date(
    webinar.startsAt.getTime() + webinar.durationMin * 60_000,
  );
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: webinar.title,
    dates: `${calendarTimestamp(webinar.startsAt)}/${calendarTimestamp(end)}`,
    details: [
      webinar.description || 'Sorena Visa live webinar.',
      webinar.joinUrl ? `Join: ${webinar.joinUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    location: 'Online — Microsoft Teams',
    ctz: 'Pacific/Auckland',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function calendarTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
