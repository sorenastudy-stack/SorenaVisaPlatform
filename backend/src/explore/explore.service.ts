import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveStudentPricing } from '../providers/student-pricing.logic';
import { PRICING_GROUP_INCLUDE, toTuitionRow, toScholarshipRow } from '../providers/pricing-rows.mapper';
import { sortExploreRows, buildMapPins, type ExploreRow, type ExploreSort } from './explore.logic';
import { ContentMatchingAgent } from '../ai/agents/content-matching.agent';

// PR-EXPLORE — the student-facing programme map.
//
// VISIBILITY GATE. Explore shows exactly what the Recommendation Engine would
// consider: reviewStatus APPROVED, isActive true, and the institution itself
// ACTIVE (matching.service.ts). Loosening it here would put programmes in front
// of students that the Owner has not approved — the whole point of the curation
// screen. Kept as one constant so the two can only drift deliberately.
const STUDENT_VISIBLE = {
  reviewStatus: 'APPROVED' as const,
  isActive: true,
  provider: { status: 'ACTIVE' as const },
};

// PR-PROVIDER-PORTAL slice A — the same rule for PRICING.
//
// Tuition and scholarships previously had only `isActive`, which is a switch the
// uploader controls, not a second pair of eyes: a spreadsheet could put a price
// in front of a client in one step. They now carry reviewStatus like programmes,
// and this is the one condition every student-facing pricing read applies.
//
// Exported so the pricing reads in other services use THIS and cannot drift —
// the same reason STUDENT_VISIBLE above is a single constant. A price shown
// without review is the failure this exists to prevent.
export const STUDENT_VISIBLE_PRICING = {
  isActive: true,
  reviewStatus: 'APPROVED' as const,
};

export interface ExploreFilters {
  sort?: ExploreSort;
  search?: string;
  level?: string;
  maxTuitionNZD?: number;
}

@Injectable()
export class ExploreService {
  private readonly logger = new Logger(ExploreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentMatching: ContentMatchingAgent,
  ) {}

  /**
   * The student's nationality drives BOTH figures on every card — a
   * nationality-scoped tuition rate and the scholarships they qualify for.
   * Falling back to a guess would quote the wrong price, so an unknown
   * nationality resolves pricing as UNKNOWN rather than assuming a default.
   */
  private async studentNationality(userId: string): Promise<string | null> {
    const contact = await this.prisma.contact.findFirst({
      where: { userId },
      select: { nationality: true },
    });
    return contact?.nationality ?? null;
  }

  async list(userId: string, filters: ExploreFilters) {
    const nationality = await this.studentNationality(userId);

    const where: any = { ...STUDENT_VISIBLE };
    if (filters.level) where.level = filters.level;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { majorStrand: { contains: filters.search, mode: 'insensitive' } },
        { subjectAreaRaw: { contains: filters.search, mode: 'insensitive' } },
        { provider: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const programmes = await this.prisma.educationProgramme.findMany({
      where,
      select: {
        id: true, name: true, level: true, nzqfLevel: true, qualificationType: true,
        majorStrand: true, subjectAreaRaw: true, campusCity: true, durationText: true,
        tuitionFeeNZD: true, tuitionFeeRaw: true, tuitionParseNote: true, coverImageUrl: true,
        provider: {
          select: {
            id: true, name: true, isFeatured: true, city: true,
            latitude: true, longitude: true, geocodeSource: true,
          },
        },
      },
    });

    const providerIds = [...new Set(programmes.map((p) => p.provider.id))];
    const [tuitions, scholarships] = await Promise.all([
      this.prisma.providerTuition.findMany({ where: { providerId: { in: providerIds }, ...STUDENT_VISIBLE_PRICING }, include: PRICING_GROUP_INCLUDE }),
      this.prisma.providerScholarship.findMany({ where: { providerId: { in: providerIds }, ...STUDENT_VISIBLE_PRICING }, include: PRICING_GROUP_INCLUDE }),
    ]);

    const rows: ExploreRow[] = programmes.map((p) => {
      const pricing = resolveStudentPricing(
        tuitions.filter((t) => t.providerId === p.provider.id).map(toTuitionRow),
        scholarships.filter((s) => s.providerId === p.provider.id).map(toScholarshipRow),
        {
          nationality: nationality ?? '',
          programmeId: p.id,
          level: p.level,
          defaultTuitionNZD: p.tuitionFeeNZD,
        },
      );
      return {
        programmeId: p.id,
        programmeName: p.name,
        providerId: p.provider.id,
        providerName: p.provider.name,
        isFeatured: p.provider.isFeatured,
        latitude: p.provider.latitude,
        longitude: p.provider.longitude,
        pricing,
      };
    });

    const filtered = filters.maxTuitionNZD != null
      // A programme with no known tuition is NOT filtered out by a budget cap:
      // "we don't know the price" is not the same as "it's too expensive", and
      // hiding it would silently shrink the student's options.
      ? rows.filter((r) => r.pricing.tuition.amountNZD == null || r.pricing.tuition.amountNZD <= filters.maxTuitionNZD!)
      : rows;

    const sorted = sortExploreRows(filtered, filters.sort ?? 'featured');
    const { pins, unmapped } = buildMapPins(sorted);
    const byId = new Map(programmes.map((p) => [p.id, p]));

    return {
      nationality,
      nationalityKnown: !!nationality,
      total: sorted.length,
      sort: filters.sort ?? 'featured',
      results: sorted.map((r) => {
        const p = byId.get(r.programmeId)!;
        return {
          id: r.programmeId,
          name: r.programmeName,
          level: p.level,
          nzqfLevel: p.nzqfLevel,
          qualificationType: p.qualificationType,
          majorStrand: p.majorStrand,
          subjectArea: p.subjectAreaRaw,
          campusCity: p.campusCity,
          durationText: p.durationText,
          coverImageUrl: p.coverImageUrl,
          provider: {
            id: r.providerId, name: r.providerName, isFeatured: r.isFeatured,
            city: p.provider.city, latitude: r.latitude, longitude: r.longitude,
          },
          pricing: {
            tuitionNZD: r.pricing.tuition.amountNZD,
            tuitionSource: r.pricing.tuition.source,
            tuitionRaw: p.tuitionFeeRaw,
            tuitionNote: p.tuitionParseNote ?? r.pricing.tuition.note,
            scholarshipNZD: r.pricing.scholarship.totalNZD,
            netCostNZD: r.pricing.netCostNZD,
          },
        };
      }),
      map: { pins, unmapped },
    };
  }

  /** One programme, with the full pricing breakdown and matched videos. */
  async detail(userId: string, programmeId: string) {
    const nationality = await this.studentNationality(userId);

    const p = await this.prisma.educationProgramme.findFirst({
      where: { id: programmeId, ...STUDENT_VISIBLE },
      include: {
        provider: true,
        requirements: true,
        intakes: true,
        studyFields: { select: { studyField: { select: { nameEn: true } } } },
      },
    });
    // Same 404 whether it does not exist or is not student-visible — a student
    // should not be able to probe which unapproved programmes exist.
    if (!p) throw new NotFoundException('Programme not found.');

    const [tuitions, scholarships] = await Promise.all([
      this.prisma.providerTuition.findMany({ where: { providerId: p.providerId, ...STUDENT_VISIBLE_PRICING }, include: PRICING_GROUP_INCLUDE }),
      this.prisma.providerScholarship.findMany({ where: { providerId: p.providerId, ...STUDENT_VISIBLE_PRICING }, include: PRICING_GROUP_INCLUDE }),
    ]);

    const pricing = resolveStudentPricing(tuitions.map(toTuitionRow), scholarships.map(toScholarshipRow), {
      nationality: nationality ?? '',
      programmeId: p.id,
      level: p.level,
      defaultTuitionNZD: p.tuitionFeeNZD,
    });

    return {
      id: p.id,
      name: p.name,
      level: p.level,
      nzqfLevel: p.nzqfLevel,
      qualificationType: p.qualificationType,
      majorStrand: p.majorStrand,
      subjectArea: p.subjectAreaRaw,
      campusCity: p.campusCity,
      durationText: p.durationText,
      durationMonths: p.durationMonths,
      deliveryMode: p.deliveryMode,
      coverImageUrl: p.coverImageUrl,
      descriptionEn: p.descriptionEn,
      programmeUrl: p.programmeUrl,
      academicPrerequisites: p.academicPrerequisites,
      englishRequirement: p.englishRequirementRaw,
      otherRequirements: p.otherRequirements,
      scholarshipNote: p.scholarshipNote,
      intakes: {
        remaining2026: p.remaining2026Intakes,
        published2027: p.published2027Intakes,
        projected2027: p.projected2027Intakes,
        basis2027: p.intakeBasis2027,
        months: p.intakeMonths,
      },
      provider: {
        id: p.provider.id, name: p.provider.name, brand: p.provider.brand,
        isFeatured: p.provider.isFeatured, city: p.provider.city,
        websiteUrl: p.provider.websiteUrl,
        latitude: p.provider.latitude, longitude: p.provider.longitude,
      },
      // The full breakdown, not just the totals: a student should be able to see
      // WHICH scholarships were applied and which could not be resolved.
      pricing: {
        nationality,
        nationalityKnown: !!nationality,
        tuition: pricing.tuition,
        tuitionRaw: p.tuitionFeeRaw,
        tuitionNote: p.tuitionParseNote,
        scholarship: pricing.scholarship,
        netCostNZD: pricing.netCostNZD,
      },
      studyFields: p.studyFields.map((s) => s.studyField.nameEn),
    };
  }

  /**
   * "What changed since you last looked."
   *
   * Reads the REAL audit trail the curation screen writes (crm_events,
   * PROGRAMME_EDITED / _ACTIVATED / _DEACTIVATED with a field-level {from,to}
   * diff) rather than diffing snapshots. That means it can only ever report
   * changes that actually happened, and it needs no extra storage.
   *
   * `since` comes from the client (the student's own last-viewed timestamp).
   * It is advisory — a wrong value shows more or less history, never data the
   * student should not see, since the programme is already gated by
   * STUDENT_VISIBLE above.
   */
  async changesSince(programmeId: string, since: Date | null) {
    const exists = await this.prisma.educationProgramme.findFirst({
      where: { id: programmeId, ...STUDENT_VISIBLE },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Programme not found.');

    const events = await this.prisma.crmEvent.findMany({
      where: {
        entityType: 'EDUCATION_PROGRAMME',
        entityId: programmeId,
        eventType: { in: ['PROGRAMME_EDITED', 'PROGRAMME_ACTIVATED', 'PROGRAMME_DEACTIVATED'] },
        ...(since ? { occurredAt: { gt: since } } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: { eventType: true, occurredAt: true, payloadJson: true },
    });

    // Only the fields a student would care about are surfaced, with
    // student-facing labels. Internal notes and provenance are never shown.
    const LABELS: Record<string, string> = {
      tuitionFeeNZD: 'Tuition fee', tuitionFeeRaw: 'Tuition details',
      scholarshipNote: 'Scholarship information', academicPrerequisites: 'Entry requirements',
      englishRequirementRaw: 'English requirement', otherRequirements: 'Other requirements',
      durationText: 'Duration', campusCity: 'Campus', deliveryMode: 'Delivery mode',
      remaining2026Intakes: '2026 intakes', published2027Intakes: '2027 intakes',
      projected2027Intakes: '2027 intakes (projected)', name: 'Programme name',
      qualificationType: 'Qualification', intakeMonths: 'Intake months',
    };

    const changes = events.flatMap((e) => {
      if (e.eventType !== 'PROGRAMME_EDITED') {
        return [{
          at: e.occurredAt,
          field: null as string | null,
          label: e.eventType === 'PROGRAMME_ACTIVATED' ? 'Now open for applications' : 'No longer accepting applications',
          from: null as any, to: null as any,
        }];
      }
      const changed = (e.payloadJson as any)?.changed ?? {};
      return Object.entries(changed)
        .filter(([field]) => field in LABELS)
        .map(([field, v]: [string, any]) => ({
          at: e.occurredAt, field, label: LABELS[field], from: v?.from ?? null, to: v?.to ?? null,
        }));
    });

    return { since, count: changes.length, changes };
  }

  /**
   * Matched videos for a programme.
   *
   * Separate from detail() on purpose: it calls Claude and the YouTube corpus,
   * which is slow and can fail. The detail page renders immediately and loads
   * this after, so an AI hiccup costs a video strip, not the whole page.
   *
   * A manual override on the programme wins outright — if the Owner has pinned
   * specific videos, no AI runs at all.
   */
  async videos(programmeId: string) {
    const p = await this.prisma.educationProgramme.findFirst({
      where: { id: programmeId, ...STUDENT_VISIBLE },
      select: {
        name: true, level: true, manualVideoIds: true, campusCity: true,
        provider: { select: { name: true, city: true } },
        studyFields: { select: { studyField: { select: { nameEn: true } } } },
      },
    });
    if (!p) throw new NotFoundException('Programme not found.');

    if (p.manualVideoIds?.length) {
      return {
        source: 'manual' as const,
        available: true,
        videos: p.manualVideoIds.map((id) => ({
          videoId: id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: null, reason: null,
        })),
      };
    }

    try {
      const result = await this.contentMatching.matchVideos({
        programmeName: p.name,
        institutionName: p.provider.name,
        city: p.campusCity ?? p.provider.city,
        level: p.level,
        studyFields: p.studyFields.map((s) => s.studyField.nameEn),
      });
      // Normalised to ONE shape regardless of source, so the page renders
      // manual and matched videos through the same component.
      return {
        source: 'matched' as const,
        available: result.available,
        videos: result.videos.map((v) => ({
          videoId: v.videoId,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          title: v.title ?? null,
          reason: v.matchReason ?? null,
        })),
      };
    } catch (e: any) {
      // Never fail the page for this. Absent videos are a missing extra, not an
      // error a student should see.
      this.logger.warn(`video matching failed for ${programmeId}: ${e?.message}`);
      return { source: 'matched' as const, available: false, videos: [] };
    }
  }
}
