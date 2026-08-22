import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export enum EventSource {
  AI = 'AI',
  OPS = 'OPS',
  LEGAL = 'LEGAL',
  SYSTEM = 'SYSTEM',
  USER = 'USER',
}

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async emit(
    eventType: string,
    entityType: string | null,
    entityId: string | null,
    leadId: string | null,
    triggerSource: string,
    actorId: string | null,
    payloadJson?: Record<string, any>,
    prismaClient?: Prisma.TransactionClient,
  ) {
    const client = prismaClient ?? this.prisma;
    return client.crmEvent.create({
      data: {
        eventType,
        entityType,
        entityId,
        leadId,
        triggerSource: (triggerSource as any) || 'SYSTEM',
        actorId,
        payloadJson: payloadJson || {},
      },
    });
  }

  /** Emit one lifecycle milestone per stable domain entity. */
  async emitOnce(
    eventType: string,
    entityType: string,
    entityId: string,
    leadId: string | null,
    triggerSource: string,
    actorId: string | null,
    payloadJson?: Record<string, any>,
    prismaClient?: Prisma.TransactionClient,
  ) {
    const client = prismaClient ?? this.prisma;
    const existing = await client.crmEvent.findFirst({
      where: { eventType, entityType, entityId },
      select: { id: true },
    });
    if (existing) return existing;
    return this.emit(eventType, entityType, entityId, leadId, triggerSource,
      actorId, payloadJson, prismaClient);
  }
}
