import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// PR-WALLET slice 2 — staff bookings list backing /staff/bookings.
//
// Admins see every consultation booking; a consultant sees only the ones
// assigned to them. Window = last 30 days onward so a just-passed session is
// still markable as no-show. PENDING (unpaid holds) are excluded.

const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);
const LISTED_STATUSES = ['BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

@Injectable()
export class StaffBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: { userId: string; role: string }, now = new Date()) {
    const isAdmin = ADMIN_TIER.has(actor.role);
    const from = new Date(now.getTime() - 30 * 86_400_000);

    const rows = await this.prisma.consultation.findMany({
      where: {
        status: { in: [...LISTED_STATUSES] },
        scheduledAt: { gte: from },
        ...(isAdmin ? {} : { assignedToId: actor.userId }),
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, type: true, status: true, paymentStatus: true, amountNZD: true,
        scheduledAt: true, bookingTimezone: true, assignedToId: true,
        assignedTo: { select: { name: true } },
        lead: { select: { contact: { select: { fullName: true, user: { select: { name: true } } } } } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      paymentStatus: r.paymentStatus,
      amountNZD: r.amountNZD,
      scheduledAt: r.scheduledAt,
      timezone: r.bookingTimezone,
      staffName: r.assignedTo?.name ?? null,
      clientName: r.lead?.contact?.fullName || r.lead?.contact?.user?.name || 'Client',
      // The UI enables No-show only once the session start has passed.
      startedOrPast: !!r.scheduledAt && r.scheduledAt.getTime() <= now.getTime(),
    }));
  }
}
