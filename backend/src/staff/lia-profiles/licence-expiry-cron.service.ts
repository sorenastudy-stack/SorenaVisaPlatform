import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { todayAsDateBoundary } from './licence-validity';

// PR-AGENT-PORTAL phase 0 — the daily licence sweep.
//
// Flips LiaProfile.isLicenceExpired so "who has lapsed" is a cheap indexed
// read rather than date arithmetic across the table. It is NOT the access
// boundary — every gate compares licenceExpiryDate itself at request time, so
// a licence that runs out at midnight stops working immediately, and this job
// silently failing cannot leave a lapsed adviser looking current. See
// licence-validity.ts for why both exist.
//
// Runs at 09:45 NZ. The daily jobs are staggered so they do not contend, and
// 09:30 was already taken by submissionFollowUpSweep — whose own comment says
// it sits after the 09:00 and 09:15 sweeps, because 09:30 was free when it was
// written. The ladder is now 09:00 visa-expiry, 09:15 nurture, 09:30 submission
// follow-up, 09:45 this one. Check the ladder before adding the next.
//
// ScheduleModule.forRoot() is registered app-wide (visa-expiry.module), so this
// @Cron is discovered without re-registering it.
const TIMEZONE = 'Pacific/Auckland';

@Injectable()
export class LicenceExpiryCronService {
  private readonly logger = new Logger(LicenceExpiryCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('45 9 * * *', { name: 'liaLicenceExpirySweep', timeZone: TIMEZONE })
  async runDailySweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (e: any) {
      // Never throw out of the scheduler: a crash here would stop the job
      // being rescheduled, and the flag would quietly stop tracking reality.
      this.logger.error(`[licence-expiry] sweep failed: ${e?.message ?? e}`);
    }
  }

  /**
   * Bring the flag in line with the dates. Returns what changed.
   *
   * Two-way on purpose. A renewed licence must clear the flag as readily as a
   * lapsed one sets it — a one-way sweep would leave an adviser who renewed
   * looking permanently expired in every queue, and the fix for that would be
   * somebody editing the database by hand.
   *
   * `now` is injectable so the behaviour at a boundary can be tested without
   * waiting for a particular day.
   */
  async sweep(now = new Date()): Promise<{ expired: number; reinstated: number }> {
    // The cutoff is TODAY as a whole date, built from LOCAL calendar parts and
    // pinned to UTC midnight.
    //
    // Two traps here, both of which a passing-looking implementation walks into:
    //
    //   licenceExpiryDate is a DATE column, so Postgres casts whatever it is
    //   compared against down to a date. A timestamp of "today at 12:00" becomes
    //   "today", and `expiry < today` is FALSE for a licence that expired today
    //   — the row silently never flips. This was caught by the boundary test,
    //   not by reading the code: JavaScript said the comparison was true while
    //   the database returned nothing.
    //
    //   Building it from UTC parts instead of local ones would shift the whole
    //   sweep by a day for half of every NZ day — the same bug as the GST
    //   period boundaries, which reported a period starting 30 June because
    //   local midnight is the previous day in UTC.
    //
    // `lt` therefore means "expired strictly before today", so a licence is
    // valid THROUGH its expiry date, which is how it reads on paper.
    const cutoff = todayAsDateBoundary(now);

    const expired = await this.prisma.liaProfile.updateMany({
      where: { licenceExpiryDate: { lt: cutoff }, isLicenceExpired: false },
      data: { isLicenceExpired: true },
    });

    const reinstated = await this.prisma.liaProfile.updateMany({
      where: {
        isLicenceExpired: true,
        OR: [
          { licenceExpiryDate: { gte: cutoff } },
          // A cleared date means "no expiry recorded", which is not expired —
          // the same rule the request-time check applies.
          { licenceExpiryDate: null },
        ],
      },
      data: { isLicenceExpired: false },
    });

    if (expired.count || reinstated.count) {
      this.logger.log(
        `[licence-expiry] ${expired.count} lapsed, ${reinstated.count} reinstated`,
      );
    }
    return { expired: expired.count, reinstated: reinstated.count };
  }
}
