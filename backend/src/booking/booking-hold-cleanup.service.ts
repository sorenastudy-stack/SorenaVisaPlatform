import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// PR-BOOKING-4 — row hygiene for expired holds.
//
// Slot AVAILABILITY is already lazy-correct (the slot engine only counts a
// PENDING consultation as busy while holdExpiresAt > now). This cron is
// pure tidy-up: it flips expired, unpaid PENDING holds to CANCELLED so they
// don't linger as dangling rows. Runs every 5 minutes.
@Injectable()
export class BookingHoldCleanupService {
  private readonly logger = new Logger(BookingHoldCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredHolds(): Promise<void> {
    const res = await this.prisma.consultation.updateMany({
      where: {
        status: 'PENDING',
        paymentStatus: { not: 'PAID' },
        holdExpiresAt: { lt: new Date() },
      },
      data: { status: 'CANCELLED' },
    });
    if (res.count > 0) {
      this.logger.log(`Released ${res.count} expired booking hold(s).`);
    }
  }
}
