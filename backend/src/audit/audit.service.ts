import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { summarizeAuditEntry } from '../common/audit/audit.helper';
import { AuditQueryDto } from './dto/audit-query.dto';

// OWNER audit-log browser (read-only). Two shapes:
//   • list()   — paginated, filtered, keyset on (createdAt, id) desc. Computes
//                a SAFE one-line summary server-side via summarizeAuditEntry and
//                DROPS the raw oldValue/newValue from the response.
//   • detail() — a single row INCLUDING full oldValue/newValue. The only place
//                raw payloads (e.g. reassignment/refund/meeting-cancel reasons)
//                are exposed — OWNER/SUPER_ADMIN only, enforced at the controller.
// Reads only: findMany / findUnique. No mutation.

const DEFAULT_LIMIT = 50;
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // last 30 days when no date filter

export interface AuditListItem {
  id: string;
  createdAt: Date;
  action: string;
  eventType: string | null;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  actorName: string;
  actorRole: string | null;
  summary: string;
}

export interface AuditListResult {
  items: AuditListItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: AuditQueryDto, now: Date = new Date()): Promise<AuditListResult> {
    const where: Prisma.AuditLogWhereInput = {};

    if (q.actorUserId) where.userId = q.actorUserId;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    // eventType filter matches the structured column OR the legacy action string.
    if (q.eventType) where.OR = [{ eventType: q.eventType }, { action: q.eventType }];

    // Date window — default to the last 30 days when the caller gives neither
    // bound (keeps an unfiltered browse off a full-table scan).
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.dateFrom) createdAt.gte = new Date(q.dateFrom);
    if (q.dateTo) createdAt.lte = new Date(q.dateTo);
    if (!q.dateFrom && !q.dateTo) createdAt.gte = new Date(now.getTime() - DEFAULT_WINDOW_MS);
    where.createdAt = createdAt;

    // Keyset cursor: rows strictly "after" (older than) the last page's tail,
    // under (createdAt desc, id desc) ordering.
    if (q.cursorCreatedAt && q.cursorId) {
      const c = new Date(q.cursorCreatedAt);
      where.AND = [
        {
          OR: [
            { createdAt: { lt: c } },
            { AND: [{ createdAt: c }, { id: { lt: q.cursorId } }] },
          ],
        },
      ];
    }

    const take = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), 100);

    // We select oldValue/newValue here ONLY to feed the summariser; they are
    // NOT returned in the list response (see the mapping below).
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // +1 to detect whether another page exists
      select: {
        id: true,
        createdAt: true,
        action: true,
        eventType: true,
        entityType: true,
        entityId: true,
        ipAddress: true,
        oldValue: true,
        newValue: true,
        actorNameSnapshot: true,
        actorRoleSnapshot: true,
        user: { select: { name: true, role: true } },
      },
    });

    const hasMore = rows.length > take;
    const page = rows.slice(0, take);

    const items: AuditListItem[] = page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      eventType: r.eventType,
      entityType: r.entityType,
      entityId: r.entityId,
      ipAddress: r.ipAddress,
      actorName: r.actorNameSnapshot ?? r.user?.name ?? '(Removed user)',
      actorRole: r.actorRoleSnapshot ?? r.user?.role ?? null,
      // Safe one-liner — never prints raw reason free-text (see audit.helper).
      summary: summarizeAuditEntry({
        eventType: r.eventType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        oldValue: r.oldValue,
        newValue: r.newValue,
      }),
      // NOTE: oldValue / newValue deliberately omitted from the list payload.
    }));

    const tail = page[page.length - 1];
    const nextCursor = hasMore && tail
      ? { createdAt: tail.createdAt.toISOString(), id: tail.id }
      : null;

    return { items, nextCursor };
  }

  // Single-row detail — the ONLY surface that returns raw oldValue/newValue.
  async detail(id: string) {
    const r = await this.prisma.auditLog.findUnique({
      where: { id },
      select: {
        id: true,
        createdAt: true,
        action: true,
        eventType: true,
        entityType: true,
        entityId: true,
        ipAddress: true,
        oldValue: true,
        newValue: true,
        actorNameSnapshot: true,
        actorRoleSnapshot: true,
        user: { select: { name: true, role: true } },
      },
    });
    if (!r) throw new NotFoundException('Audit entry not found');

    return {
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      eventType: r.eventType,
      entityType: r.entityType,
      entityId: r.entityId,
      ipAddress: r.ipAddress,
      actorName: r.actorNameSnapshot ?? r.user?.name ?? '(Removed user)',
      actorRole: r.actorRoleSnapshot ?? r.user?.role ?? null,
      summary: summarizeAuditEntry({
        eventType: r.eventType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        oldValue: r.oldValue,
        newValue: r.newValue,
      }),
      oldValue: r.oldValue,
      newValue: r.newValue,
    };
  }
}
