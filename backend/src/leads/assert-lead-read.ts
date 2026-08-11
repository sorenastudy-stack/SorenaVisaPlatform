import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';
import { LeadsService } from './leads.service';

// PR-ACCESS-AUDIT — the lead-read gate, as one call.
//
// LeadsService.findOne already enforces this, but only for callers that go
// through it. Intake and scoring take a leadId and read the same lead's most
// sensitive derived data — readiness, financial capacity, risk band — without
// ever touching that method, so the boundary stopped at the door of one class.
//
// Same rule, stated once, callable from anywhere that holds a leadId.

export interface LeadViewer {
  id?: string | null;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
}

/**
 * Throws unless this actor may read this lead.
 *
 * NOT FOUND for a lead that exists but belongs to someone else — identical to
 * genuine absence, so the answer never confirms a record the caller is not
 * entitled to know about. Mirrors LeadsService.findOne exactly; if the
 * ownership rule changes there, it must change here too, which is why both
 * read the same FUNNEL_OVERSIGHT_ROLES constant rather than their own lists.
 */
export async function assertLeadReadable(
  prisma: PrismaService,
  leadId: string,
  actor: LeadViewer | null | undefined,
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { ownerId: true },
  });
  if (!lead) throw new NotFoundException('Lead not found');

  // No actor at all means the caller could not be identified — deny rather
  // than fall through to the oversight branch.
  if (!actor) throw new ForbiddenException('You are not allowed to view this lead.');

  if (hasRole(actor, ...LeadsService.FUNNEL_OVERSIGHT_ROLES)) return;

  if (!actor.id || lead.ownerId !== actor.id) {
    throw new NotFoundException('Lead not found');
  }
}
