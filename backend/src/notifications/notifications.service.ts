import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-HANDOFF — in-app notifications, kept deliberately small.
//
// Enough for an unread badge and a list a person can clear. Not a delivery
// framework: no channels, no preferences, no templating. A second sender adds a
// `type` string and nothing else.

const LIST_LIMIT = 30;

export interface CreateNotification {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotification) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });
  }

  /** The badge. Counted rather than derived from the list, so a long backlog
   *  does not make the count depend on the page size. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  /** Newest first, unread included — the list is read after the badge draws
   *  attention to it, so it has to show what the badge was counting. */
  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        // id breaks ties: createdAt has millisecond precision, and two
        // notifications raised in the same millisecond would otherwise come
        // back in an arbitrary order — visibly so, since the newest is the one
        // the badge just appeared for. cuid is monotonic within a process.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
      }),
      this.unreadCount(userId),
    ]);
    return { items, unread };
  }

  /** Mark one as read. Scoped by userId in the WHERE, not checked afterwards,
   *  so another user's id simply matches nothing. */
  async markRead(id: string, userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    if (res.count === 0) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { ok: true, updated: res.count };
  }
}
