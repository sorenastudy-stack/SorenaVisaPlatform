import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  ) {
    return this.prisma.crmEvent.create({
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
}
