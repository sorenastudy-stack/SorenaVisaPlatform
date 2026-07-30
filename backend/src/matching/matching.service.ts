import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  rankRecommendations, allowedFieldIds,
  type MatchCriteria, type ProgrammeForMatch, type FieldNode, type RelationEdge, type QualLevel,
  type InstitutionType, type InstitutionWeighting,
} from './matching.logic';

// PR-PHASE32 — Matching Engine service: hydrates the pure ranking core from the
// DB. Only APPROVED programmes from ACTIVE providers are ever considered, so
// unapproved/draft enrichment never reaches an applicant. Scholarships are
// scoped to the applicant's nationality.
@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  // Active StudyFields for rendering the Q13 (qualification) + Q32 (preferred)
  // pickers. Includes the category's alwaysSelectable flag.
  async listStudyFields() {
    return this.prisma.studyField.findMany({
      where: { isActive: true },
      orderBy: [{ category: { displayOrder: 'asc' } }, { displayOrder: 'asc' }],
      select: {
        id: true, key: true, nameEn: true, nameFa: true,
        category: { select: { key: true, nameEn: true, nameFa: true, alwaysSelectable: true } },
      },
    });
  }

  // Server-authoritative Q30 allowed-field set for a given prior-qualification
  // field. The Q32 UI filters to exactly this — it can never diverge from the
  // matcher, which re-derives the same set.
  async allowedFieldIdsFor(qualificationFieldId: string | null): Promise<string[]> {
    const fields = await this.prisma.studyField.findMany({ select: { id: true, category: { select: { alwaysSelectable: true } } } });
    const rels = await this.prisma.studyFieldRelation.findMany({ where: { reviewStatus: 'APPROVED' }, select: { sourceFieldId: true, targetFieldId: true } });
    const nodes: FieldNode[] = fields.map((f) => ({ id: f.id, categoryAlwaysSelectable: f.category.alwaysSelectable }));
    const edges: RelationEdge[] = rels.map((r) => ({ ...r, approved: true }));
    return [...allowedFieldIds(qualificationFieldId, nodes, edges)];
  }

  async recommend(criteria: MatchCriteria) {
    const fields = await this.prisma.studyField.findMany({
      select: { id: true, category: { select: { alwaysSelectable: true } } },
    });
    const fieldNodes: FieldNode[] = fields.map((f) => ({ id: f.id, categoryAlwaysSelectable: f.category.alwaysSelectable }));

    const rels = await this.prisma.studyFieldRelation.findMany({
      where: { reviewStatus: 'APPROVED' },
      select: { sourceFieldId: true, targetFieldId: true },
    });
    const relEdges: RelationEdge[] = rels.map((r) => ({ ...r, approved: true }));

    const programmes = await this.prisma.educationProgramme.findMany({
      where: { reviewStatus: 'APPROVED', isActive: true, provider: { status: 'ACTIVE' } },
      include: { requirements: true, studyFields: { select: { studyFieldId: true } }, provider: true },
    });

    // PR-OWNER-1 (slice b) — the destination-country institution-type weighting
    // (Owner-editable). All programmes are NZ today; when multiple destinations
    // exist this would key off the programme's provider.country. No config row →
    // weighting undefined and the matcher runs the legacy 5-factor path unchanged.
    const execConfig = await this.prisma.countryExecutionConfig.findUnique({ where: { countryCode: 'NZ' } });
    const weighting = (execConfig?.institutionTypeWeighting as unknown as InstitutionWeighting | null) ?? undefined;

    const scholarships = criteria.nationality
      ? await this.prisma.providerScholarship.findMany({ where: { isActive: true, nationality: criteria.nationality } })
      : [];
    const scholarshipsFor = (p: (typeof programmes)[number]) =>
      scholarships.filter(
        (s) => s.providerId === p.providerId
          && (s.programmeId === null || s.programmeId === p.id)
          && (s.level === null || s.level === p.level),
      );

    const forMatch: ProgrammeForMatch[] = programmes.map((p) => ({
      id: p.id,
      approved: true,
      providerApproved: true,
      studyFieldIds: p.studyFields.map((sf) => sf.studyFieldId),
      level: p.level as QualLevel,
      institutionType: (p.provider.institutionType as InstitutionType | null) ?? null,
      tuitionFeeNZD: p.tuitionFeeNZD,
      intakeMonths: p.intakeMonths,
      city: p.provider.city,
      req: p.requirements
        ? {
            minQualificationLevel: (p.requirements.minQualificationLevel as QualLevel | null) ?? null,
            minGpa: p.requirements.minGpa,
            englishOverallMin: p.requirements.englishOverallMin,
          }
        : null,
      scholarshipsForNationality: scholarshipsFor(p).map((s) => ({ name: s.name, nationality: s.nationality })),
      rankingScore: p.provider.rankingScore,
    }));

    const recs = rankRecommendations(forMatch, criteria, fieldNodes, relEdges, weighting);
    const byId = new Map(programmes.map((p) => [p.id, p]));

    return recs.map((r) => {
      const p = byId.get(r.programmeId)!;
      return {
        programmeId: p.id,
        programmeName: p.name,
        providerName: p.provider.name,
        level: p.level,
        nzqfLevel: p.nzqfLevel,
        city: p.provider.city,
        tuitionFeeNZD: p.tuitionFeeNZD,
        currency: p.currency,
        intakeMonths: p.intakeMonths,
        descriptionEn: p.descriptionEn,
        descriptionFa: p.descriptionFa,
        careerOutcomes: p.careerOutcomes,
        highlights: p.highlights,
        rankingTier: p.provider.rankingTier,
        institutionType: p.provider.institutionType, // PR-RECS-1 — snapshot for the persisted list + slot rules
        scholarships: scholarshipsFor(p).map((s) => ({ name: s.name })),
        fitScore: r.fitScore,
        whyThisFits: r.why, // deterministic dimensions → Recommendation Explanation Agent renders prose
      };
    });
  }
}
