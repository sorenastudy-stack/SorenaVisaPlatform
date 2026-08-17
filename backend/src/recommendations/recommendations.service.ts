import {
  BadRequestException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { EventsService, EventSource } from '../events/events.service';
import { MATCH_CRITERIA_RESOLVER, type MatchCriteriaResolver } from '../matching/criteria/match-criteria-resolver';

// PR-RECS-1 (slice 1) — persisted, client-viewable recommendation lists.
//
// generate(): resolve the student's MatchCriteria (via the seam) → run the
// existing matcher (already applies the Owner-editable institution weighting from
// PR-OWNER-1) → snapshot a new RecommendationList + items, superseding the prior
// one. No slot logic here — that's slice 2.

interface Actor { id: string | null; name?: string | null; role?: string | null }

const SORTABLE = ['default', 'tuition', 'startDate', 'duration', 'city', 'featured'] as const;

// PR-RECS-PHASE1 — how many suggestions to show in Apply/Study.
//
// DELIBERATELY NOT CountryExecutionConfig.slotCount, which also happens to be 5.
// slotCount is how many programmes a student may CHOOSE; this is how many we
// SUGGEST alongside. They answer different questions and must be able to move
// independently — coupling them would mean raising the choice limit silently
// changed how much we steer. A test asserts they stay separate.
export const SUGGESTION_COUNT = 5;
export type RecommendationSort = (typeof SORTABLE)[number];

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly events: EventsService,
    @Inject(MATCH_CRITERIA_RESOLVER) private readonly resolver: MatchCriteriaResolver,
  ) {}

  // Resolve the logged-in student's OWN CRM case (never trust a client-supplied
  // caseId). Mirrors DashboardService: User → Contact → Lead → Case.
  async resolveCaseIdForStudent(userId: string): Promise<string> {
    const contact = await this.prisma.contact.findFirst({ where: { userId }, select: { id: true } });
    if (!contact) throw new NotFoundException('No student profile found.');
    const lead = await this.prisma.lead.findFirst({ where: { contactId: contact.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!lead) throw new NotFoundException('No lead found for this student.');
    const kase = await this.prisma.case.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!kase) throw new NotFoundException('No case found for this student.');
    return kase.id;
  }

  // Generate (or regenerate) the list for a case. Supersedes the prior active list.
  async generateForCase(caseId: string, studentUserId: string, actor: Actor) {
    const kase = await this.prisma.case.findUnique({ where: { id: caseId }, select: { id: true, leadId: true } });
    if (!kase) throw new NotFoundException('Case not found.');

    const resolved = await this.resolver.resolve(studentUserId);
    if (!resolved) {
      throw new BadRequestException('No completed assessment found. Complete the assessment before generating recommendations.');
    }

    const recs = await this.matching.recommend(resolved.criteria);

    // Strip undefined (JSON columns reject it) — keep the criteria snapshot clean.
    const criteriaJson = JSON.parse(JSON.stringify(resolved.criteria)) as Prisma.InputJsonValue;

    const list = await this.prisma.$transaction(async (tx) => {
      await tx.recommendationList.updateMany({
        where: { caseId, status: { in: ['GENERATED', 'VIEWED'] } },
        data: { status: 'SUPERSEDED' },
      });
      const created = await tx.recommendationList.create({
        data: { caseId, status: 'GENERATED', criteriaSource: resolved.source, criteriaJson },
      });
      if (recs.length > 0) {
        await tx.recommendationItem.createMany({
          data: recs.map((r, i) => ({
            recommendationListId: created.id,
            programmeId: r.programmeId,
            rank: i + 1,
            fitScore: r.fitScore,
            institutionType: r.institutionType ?? null,
            whyJson: (r.whyThisFits ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      return created;
    });

    await this.events.emit(
      'RECOMMENDATION_LIST_GENERATED', 'CASE', caseId, kase.leadId, EventSource.USER, actor.id,
      { listId: list.id, itemCount: recs.length, source: resolved.source },
    );
    this.logger.log(`Recommendation list ${list.id} generated for case ${caseId} (${recs.length} items, ${resolved.source})`);

    return { listId: list.id, itemCount: recs.length, source: resolved.source, generatedAt: list.generatedAt };
  }

  // The current (non-superseded) list for a case, items joined to live programme
  // data for display + sorted. markViewed flips GENERATED → VIEWED on first read.
  async getCurrentForCase(caseId: string, sort: RecommendationSort = 'default', markViewed = false) {
    const list = await this.prisma.recommendationList.findFirst({
      where: { caseId, status: { in: ['GENERATED', 'VIEWED', 'CONFIRMED'] } },
      orderBy: { generatedAt: 'desc' },
    });
    if (!list) return null;

    const items = await this.prisma.recommendationItem.findMany({
      where: { recommendationListId: list.id },
      include: {
        programme: {
          include: {
            provider: { select: { name: true, city: true, rankingTier: true, rankingScore: true } },
            intakes: { select: { year: true, label: true, basis: true } },
          },
        },
      },
    });

    if (markViewed && list.status === 'GENERATED') {
      await this.prisma.recommendationList.update({ where: { id: list.id }, data: { status: 'VIEWED' } });
      list.status = 'VIEWED';
    }

    const shaped = items.map((it) => ({
      id: it.id,
      rank: it.rank,
      fitScore: it.fitScore,
      institutionType: it.institutionType,
      why: it.whyJson,
      programmeId: it.programmeId,
      programmeName: it.programme.name,
      providerName: it.programme.provider.name,
      city: it.programme.provider.city,
      level: it.programme.level,
      nzqfLevel: it.programme.nzqfLevel,
      tuitionFeeNZD: it.programme.tuitionFeeNZD,
      currency: it.programme.currency,
      durationMonths: it.programme.durationMonths,
      durationText: it.programme.durationText,
      rankingTier: it.programme.provider.rankingTier,
      rankingScore: it.programme.provider.rankingScore,
      intakes: it.programme.intakes,
    }));

    return {
      listId: list.id,
      status: list.status,
      criteriaSource: list.criteriaSource,
      generatedAt: list.generatedAt,
      items: this.sortItems(shaped, sort),
    };
  }

  // ── PR-RECS-PHASE1 — suggestions inside Apply/Study ───────────────────────
  //
  // "Others you might also consider", shown AFTER the student has made their own
  // programme choice. Read-only: this returns programmes to look at, and can
  // never create an AdmissionProgrammeChoice. A suggestion is not a commitment.
  //
  // TIMING IS ENFORCED HERE, not just in the UI. With no choice on record the
  // method returns `available: false` and NO items at all, so the suggestions
  // cannot leak in front of the student's own decision even if a screen called
  // this too early. The student decides first; we react.
  //
  // ELIGIBILITY is inherited, not re-implemented: the list comes from the same
  // matcher, which hard-excludes disallowed study fields via allowedFieldIds()
  // (the Q30 progression rule). Nothing here relaxes that, and no near-miss
  // "you would need X" programmes are surfaced in this phase.
  //
  // EXPLANATIONS are the existing deterministic whyThisFits dimensions, passed
  // through untouched. No generated prose.
  async getSuggestionsForAdmission(caseId: string, studentUserId: string) {
    // Programmes the student has already chosen — never suggest one of those back.
    const chosen = await this.prisma.admissionProgrammeChoice.findMany({
      where: { admissionApplication: { caseId } },
      select: { programmeId: true },
    });

    if (chosen.length === 0) {
      return {
        available: false,
        reason: 'NO_CHOICE_YET' as const,
        items: [],
        suggestionCount: SUGGESTION_COUNT,
      };
    }

    let current = await this.getCurrentForCase(caseId, 'default', false);

    // No list yet — build one from the same matcher. A student with no completed
    // assessment simply gets no suggestions; it is not an error on this surface.
    if (!current) {
      try {
        await this.generateForCase(caseId, studentUserId, { id: studentUserId });
        current = await this.getCurrentForCase(caseId, 'default', false);
      } catch {
        return { available: false, reason: 'NO_ASSESSMENT' as const, items: [], suggestionCount: SUGGESTION_COUNT };
      }
    }
    if (!current) {
      return { available: false, reason: 'NO_ASSESSMENT' as const, items: [], suggestionCount: SUGGESTION_COUNT };
    }

    const chosenIds = new Set(chosen.map((c) => c.programmeId));
    const items = current.items
      .filter((it) => !chosenIds.has(it.programmeId))
      .slice(0, SUGGESTION_COUNT);

    return {
      available: items.length > 0,
      reason: items.length > 0 ? ('OK' as const) : ('NO_MATCHES' as const),
      listId: current.listId,
      generatedAt: current.generatedAt,
      suggestionCount: SUGGESTION_COUNT,
      items,
    };
  }

  // Sort a shaped item list per PRD_4 §7/§13. 'default' = the frozen ranked order.
  private sortItems<T extends {
    rank: number; fitScore: number; tuitionFeeNZD: number | null; durationMonths: number | null;
    city: string | null; rankingScore: number | null; intakes: { year: number }[];
  }>(items: T[], sort: RecommendationSort): T[] {
    const arr = [...items];
    switch (sort) {
      case 'tuition':
        return arr.sort((a, b) => (a.tuitionFeeNZD ?? Infinity) - (b.tuitionFeeNZD ?? Infinity));
      case 'duration':
        return arr.sort((a, b) => (a.durationMonths ?? Infinity) - (b.durationMonths ?? Infinity));
      case 'city':
        return arr.sort((a, b) => (a.city ?? '').localeCompare(b.city ?? ''));
      case 'featured':
        return arr.sort((a, b) => (b.rankingScore ?? -1) - (a.rankingScore ?? -1));
      case 'startDate':
        return arr.sort((a, b) => this.earliestIntakeYear(a.intakes) - this.earliestIntakeYear(b.intakes));
      case 'default':
      default:
        return arr.sort((a, b) => a.rank - b.rank);
    }
  }

  private earliestIntakeYear(intakes: { year: number }[]): number {
    return intakes.length ? Math.min(...intakes.map((i) => i.year)) : Number.MAX_SAFE_INTEGER;
  }
}
