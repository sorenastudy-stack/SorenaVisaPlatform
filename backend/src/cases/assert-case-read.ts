import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { canReadCase } from './case-access.helper';

// PR-ACCESS-AUDIT — the case-read gate, as one call.
//
// canReadCase is a pure function and five services already load the case
// themselves to feed it. Two more needed the same thing, and copying the
// load-and-check into each is how the two that were missing it went unnoticed
// in the first place — nothing named the omission.
//
// Deliberately reuses canReadCase rather than restating the rules. Its LIA
// clause ("sees all cases") is a locked operational policy, not an oversight;
// changing it is its own decision and must change in one place when it does.

export interface CaseViewer {
  userId: string;
  role: string;
}

/**
 * Throws unless this viewer may read this case.
 *
 * NOT FOUND for a case that exists but is not theirs — telling a caller "that
 * case is real, just not yours" discloses the case. Genuine absence and denial
 * are answered identically, on purpose.
 */
export async function assertCaseReadable(
  prisma: PrismaService,
  caseId: string,
  viewer: CaseViewer | null | undefined,
): Promise<void> {
  if (!viewer?.userId || !viewer.role) {
    throw new ForbiddenException('You are not allowed to view this case.');
  }

  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      ownerId: true, liaId: true, supportId: true,
      financeId: true, consultantId: true,
    },
  });
  if (!kase) throw new NotFoundException('Case not found');

  if (!canReadCase(kase, viewer)) {
    throw new NotFoundException('Case not found');
  }
}
