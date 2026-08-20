import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// PR-WEBINAR-2 — auto-clone the next occurrence of a recurring webinar series.
//
// `ScheduleModule.forRoot()` is already registered app-wide (VisaExpiryModule),
// so this @Cron is discovered without re-registering it — the same pattern
// NurtureCronService relies on.
//
// A "series" is any Webinar row with `recurrenceDays` set (e.g. 7 for weekly).
// Once that row's session has ended (`startsAt + durationMin` in the past) and
// no future row for the same slug already exists, this clones it forward —
// same title/description/duration/speaker/topic/joinUrl/slug — and marks the
// old row ENDED. Staff sets `recurrenceDays` once on the first row and the
// series perpetuates itself with no manual weekly task.
//
// Runs every 6 hours rather than daily so a missed or late run (deploy,
// restart) doesn't leave a multi-day gap with no bookable "next" session.
// Cheap at that frequency: the query only touches rows whose session already
// ended.
@Injectable()
export class WebinarsRecurrenceCron {
  private readonly logger = new Logger(WebinarsRecurrenceCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 */6 * * *')
  async handleCron() {
    await this.advanceRecurringWebinars();
  }

  /**
   * Where the next occurrence actually falls.
   *
   * Advancing by a single interval is wrong whenever the series has been
   * dormant longer than one interval — after a week of downtime a +7-day clone
   * is still in the past, so it would be born already-ended and the series
   * would crawl forward one run at a time while every registration in the
   * meantime found no upcoming session and 404'd. Stepping until the date is
   * genuinely ahead of `now` makes a gap self-heal on the first run instead.
   *
   * Exported for the test to pin the arithmetic without waiting on a clock.
   */
  static nextOccurrence(startsAt: Date, recurrenceDays: number, now: Date): Date {
    const step = recurrenceDays * 24 * 60 * 60_000;
    let next = new Date(startsAt.getTime() + step);
    while (next.getTime() <= now.getTime()) {
      next = new Date(next.getTime() + step);
    }
    return next;
  }

  async advanceRecurringWebinars(now: Date = new Date()): Promise<{ advanced: number }> {
    const candidates = await this.prisma.webinar.findMany({
      where: {
        recurrenceDays: { not: null },
        status: { in: ['SCHEDULED', 'LIVE'] },
      },
    });

    let advanced = 0;
    for (const w of candidates) {
      const endsAt = new Date(w.startsAt.getTime() + w.durationMin * 60_000);
      if (endsAt > now) continue; // session hasn't finished yet

      // Skip the clone if a future occurrence of this series already exists —
      // guards against double-cloning when the cron fires again before the
      // mark-ENDED write lands, or when staff already created the next one by
      // hand. The old row is still closed off either way.
      const nextExists = await this.prisma.webinar.findFirst({
        where: { slug: w.slug, startsAt: { gt: w.startsAt } },
        select: { id: true },
      });

      const nextStartsAt = WebinarsRecurrenceCron.nextOccurrence(
        w.startsAt,
        w.recurrenceDays!,
        now,
      );

      await this.prisma.$transaction(async (tx) => {
        if (!nextExists) {
          await tx.webinar.create({
            data: {
              slug: w.slug,
              title: w.title,
              description: w.description,
              startsAt: nextStartsAt,
              durationMin: w.durationMin,
              speaker: w.speaker,
              topic: w.topic,
              joinUrl: w.joinUrl,
              recurrenceDays: w.recurrenceDays,
              status: 'SCHEDULED',
            },
          });
        }
        await tx.webinar.update({
          where: { id: w.id },
          data: { status: 'ENDED' },
        });
      });

      advanced++;
      this.logger.log(
        `[webinar-recurrence] advanced '${w.slug}' past ${w.startsAt.toISOString()}` +
        (nextExists ? ' (next already existed)' : ` → ${nextStartsAt.toISOString()}`),
      );
    }

    return { advanced };
  }
}
