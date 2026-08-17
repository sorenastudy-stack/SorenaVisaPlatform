import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-PROVIDER-PORTAL slice F — what an institution can see about its own reach.
//
// Two numbers per programme, both of them theirs:
//   • recommended — how often our matcher put this programme in front of a student
//   • chosen      — how often a student then picked it on an application
//
// NOTHING COMPARATIVE. No platform totals, no ranking, no "you are 4th of 23".
// An institution seeing its position relative to others is a different product
// with different consent behind it, and the absence is deliberate rather than
// pending.
//
// LIVE-QUERIED, NO PRE-AGGREGATION. One query with two correlated counts, scoped
// to the caller — not N+1, and not a cached table that can drift. At today's
// volume (5 recommendation items, 685 programme choices across the whole
// database) this is a trivial amount of work; the note in the phase doc says
// where the ceiling is if that changes.

export interface ProviderAnalyticsActor {
  providerId: string;
}

@Injectable()
export class ProviderAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: ProviderAnalyticsActor) {
    const programmes = await this.prisma.educationProgramme.findMany({
      // The whole boundary, in one clause: the caller's own programmes and no
      // others. There is no id to supply and nothing to compare against.
      where: { providerId: actor.providerId },
      select: {
        id: true,
        name: true,
        level: true,
        campusCity: true,
        isActive: true,
        reviewStatus: true,
        _count: { select: { recommendationItems: true, admissionChoices: true } },
      },
      orderBy: { name: 'asc' },
    });

    const rows = programmes.map((p) => ({
      id: p.id,
      name: p.name,
      level: p.level,
      campusCity: p.campusCity,
      // Shown so a zero can be read correctly: a programme nobody has seen yet
      // and a programme still awaiting review are different kinds of zero.
      isActive: p.isActive,
      reviewStatus: p.reviewStatus,
      recommended: p._count.recommendationItems,
      chosen: p._count.admissionChoices,
    }));

    return {
      programmes: rows,
      totals: {
        programmes: rows.length,
        recommended: rows.reduce((n, r) => n + r.recommended, 0),
        chosen: rows.reduce((n, r) => n + r.chosen, 0),
      },
    };
  }
}
