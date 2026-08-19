import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CLIENT_DOCUMENT_FOLLOW_UP,
  CLIENT_FOLLOW_UP_DAYS,
  followUpLink,
  planClientDocumentFollowUps,
  type OutstandingRequest,
} from './document-follow-up.logic';

// PR-CHECKLIST item 3 — raises the 2-week client document chase, and clears it
// when the document arrives.
//
// The notice goes to the staff member who ASKED for the document, not to the
// client. The checklist calls for a CRM notification: the system's job is to
// stop a request quietly ageing out of someone's memory, and the person who
// asked is the one who knows what they were waiting for and why.
@Injectable()
export class DocumentFollowUpService {
  private readonly logger = new Logger(DocumentFollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async runDailySweep(now: Date = new Date()): Promise<{ created: number }> {
    // Only cases still in play. A withdrawn or completed case does not need
    // anyone chased, and would otherwise generate a notice forever.
    const rows = await this.prisma.caseMessage.findMany({
      where: {
        kind: 'DOCUMENT_REQUEST',
        fulfilledAt: null,
        case: { stage: { notIn: ['COMPLETED', 'WITHDRAWN'] } },
      },
      select: {
        id: true,
        caseId: true,
        createdAt: true,
        requestedDocType: true,
        authorId: true,
        case: { select: { consultantId: true } },
      },
    });
    if (rows.length === 0) return { created: 0 };

    const requests: OutstandingRequest[] = rows.map((r) => ({
      messageId: r.id,
      caseId: r.caseId,
      requestedAt: r.createdAt,
      requestedDocType: r.requestedDocType,
      requesterId: r.authorId,
      consultantId: r.case?.consultantId ?? null,
    }));

    // Read AND unread: a notice that was cleared must not come back. The client
    // still owing the document is the LIA's problem to pursue in the thread, not
    // grounds for the same notification to reappear every morning.
    const links = requests.map((r) => followUpLink(r.caseId, r.messageId));
    const seen = await this.prisma.notification.findMany({
      where: { type: CLIENT_DOCUMENT_FOLLOW_UP, link: { in: links } },
      select: { link: true },
    });
    const already = new Set(seen.map((s) => s.link).filter((l): l is string => !!l));

    const notices = planClientDocumentFollowUps(requests, already, now);

    let created = 0;
    for (const n of notices) {
      try {
        await this.notifications.create({
          userId: n.userId,
          type: CLIENT_DOCUMENT_FOLLOW_UP,
          title: n.title,
          body: `No response after ${CLIENT_FOLLOW_UP_DAYS} days. Follow up with the client in the case thread.`,
          link: n.link,
        });
        created++;
      } catch (err: any) {
        // One bad recipient must not cost the rest of the sweep.
        this.logger.warn(`could not raise follow-up for message ${n.messageId}: ${err?.message ?? err}`);
      }
    }

    return { created };
  }
}
