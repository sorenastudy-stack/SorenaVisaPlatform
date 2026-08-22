import { Injectable } from '@nestjs/common';
import { generateClientId } from '../leads/client-id';
import { PrismaService } from '../prisma/prisma.service';
import { eligibleIntakes, isConditionalOffer } from '../matching/intake-window';
import { EventsService } from '../events/events.service';
import { ScoringService } from '../scoring/scoring.service';
import { HighRiskEngineService } from '../scoring/high-risk-engine.service';
import { MailService } from '../mail/mail.service';
import { LeadStatus, RecommendedRoute, ReviewStatus } from '@prisma/client';
import { normalizeEmail } from '../common/normalize-email';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private scoringService: ScoringService,
    private riskEngine: HighRiskEngineService,
    private mail: MailService,
  ) {}

  async submitIntakeForm(data: {
    fullName: string;
    // PR-AUDIT-4 — email/destination/preferredLevel relaxed to
    // optional to match runtime behaviour: the `data.email ? upsert
    // : create` branch tolerates a missing email, Contact
    // .countryOfResidence + IntakeForm.preferredLevel are both
    // nullable in the schema, and preferredLevel is declared on
    // ScoringService.IntakeFormData but never actually read.
    // Honest types — no call-site cast needed.
    email?: string;
    phone?: string;
    whatsapp?: string;
    destination?: string;
    nationality?: string;
    preferredLevel?: string;
    preferredLanguage?: string;
    highestQualification?: string;
    fieldOfStudy?: string;
    englishTestType?: string;
    englishOverallScore?: number;
    financialLevel?: string;
    estimatedBudgetNZD?: number;
    visaRejectionCount?: number;
    studyIntent?: string;
    preferredStartDate?: string;
  }) {
    try {
      console.log('[INTAKE] Received payload:', JSON.stringify(data, null, 2));
      const intakeResult = await this.prisma.$transaction(async (tx) => {
      // Create or update contact using unique email if available
      const normalizedEmail = normalizeEmail(data.email);
      let contact;
      if (normalizedEmail) {
        contact = await tx.contact.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        });
        contact = contact
          ? await tx.contact.update({
              where: { id: contact.id },
              data: {
                fullName: data.fullName,
                phone: data.phone,
                whatsapp: data.whatsapp,
                nationality: data.nationality,
                preferredLanguage: data.preferredLanguage || undefined,
                countryOfResidence: data.destination || undefined,
              },
            })
          : await tx.contact.create({
              data: {
                fullName: data.fullName,
                email: normalizedEmail,
                phone: data.phone,
                whatsapp: data.whatsapp,
                nationality: data.nationality,
                preferredLanguage: data.preferredLanguage || 'en',
                countryOfResidence: data.destination,
              },
            });
      } else {
        contact = await tx.contact.create({
          data: {
            fullName: data.fullName,
            phone: data.phone,
            whatsapp: data.whatsapp,
            nationality: data.nationality,
            preferredLanguage: data.preferredLanguage || 'en',
            countryOfResidence: data.destination,
          },
        });
      }

      // Create lead — PR-CLIENT-ID assigns the permanent human-readable id.
      const clientId = await generateClientId(tx, {
        countryOfResidence: data.destination,
        contactId: contact.id,
      });
      const lead = await tx.lead.create({
        data: {
          clientId,
          contactId: contact.id,
          sourceChannel: 'PUBLIC_INTAKE',
          leadStatus: LeadStatus.INTAKE_STARTED,
        },
      });

      // Create intake form
      const intakeForm = await tx.intakeForm.create({
        data: {
          leadId: lead.id,
          highestQualification: data.highestQualification,
          fieldOfStudy: data.fieldOfStudy,
          englishTestType: data.englishTestType,
          englishOverallScore: data.englishOverallScore,
          financialLevel: data.financialLevel,
          estimatedBudgetNZD: data.estimatedBudgetNZD,
          visaRejectionCount: data.visaRejectionCount || 0,
          studyIntent: data.studyIntent,
          preferredStartDate: data.preferredStartDate,
          preferredLevel: data.preferredLevel,
          preferredField: data.fieldOfStudy,
          completionPercent: 100, // Public form is complete
        },
      });

      // Calculate score
      const scoreResult = this.scoringService.calculateScores({
        highestQualification: data.highestQualification,
        fieldOfStudy: data.fieldOfStudy,
        englishTestType: data.englishTestType,
        englishOverallScore: data.englishOverallScore,
        financialLevel: data.financialLevel,
        estimatedBudgetNZD: data.estimatedBudgetNZD,
        visaRejectionCount: data.visaRejectionCount,
        studyIntent: data.studyIntent,
        preferredStartDate: data.preferredStartDate ? new Date(data.preferredStartDate) : undefined,
        preferredLevel: data.preferredLevel,
        preferredField: data.fieldOfStudy,
        completionPercent: 100,
      });

      const riskResult = this.riskEngine.assessRisk(
        {
          highestQualification: data.highestQualification,
          fieldOfStudy: data.fieldOfStudy,
          englishTestType: data.englishTestType,
          englishOverallScore: data.englishOverallScore,
          financialLevel: data.financialLevel,
          estimatedBudgetNZD: data.estimatedBudgetNZD,
          visaRejectionCount: data.visaRejectionCount,
          visaRejectionReason: undefined,
          studyIntent: data.studyIntent,
          preferredStartDate: data.preferredStartDate ? new Date(data.preferredStartDate) : undefined,
          preferredLevel: data.preferredLevel,
          preferredField: data.fieldOfStudy,
          completionPercent: 100,
        },
        scoreResult.scoreBand,
      );

      const recommendedRoute = this.determineRecommendedRoute(
        scoreResult.bandNumber,
        riskResult.riskLevel as any,
      );

      const hasVisaRefusal = (data.visaRejectionCount ?? 0) > 0;
      const hardStop = hasVisaRefusal ? 'HS4' : null;
      const finalRoute = hasVisaRefusal
        ? RecommendedRoute.LIA_CONSULTATION
        : recommendedRoute;

      // Update lead with detailed score and risk metadata
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          readinessScore: scoreResult.readinessScore,
          academicScore: scoreResult.academicScore,
          financialScore: scoreResult.financialScore,
          englishScore: scoreResult.englishScore,
          intentScore: scoreResult.intentScore,
          engagementScore: scoreResult.engagementScore,
          scoreBand: scoreResult.scoreBand,
          riskLevel: riskResult.riskLevel as any,
          hardStopFlag: hasVisaRefusal || riskResult.hardStopFlag,
          hardStopReason: hasVisaRefusal ? 'HS4: previous visa refusal' : riskResult.hardStopReason,
          executionAllowed: hasVisaRefusal ? false : riskResult.executionAllowed,
          recommendedRoute: finalRoute as any,
          leadStatus: LeadStatus.SCORING_DONE,
        },
      });

      // Emit events
      await this.eventsService.emit(
        'LEAD_CREATED',
        'LEAD',
        lead.id,
        lead.id,
        'SYSTEM',
        null,
        { source: 'PUBLIC_INTAKE' },
        tx,
      );

      await this.eventsService.emit(
        'INTAKE_COMPLETED',
        'INTAKE',
        intakeForm.id,
        lead.id,
        'SYSTEM',
        null,
        { scoreResult, riskResult, recommendedRoute: finalRoute },
        tx,
      );

      return {
        leadId: lead.id,
        scoreBand: scoreResult.scoreBand,
        readinessScore: scoreResult.readinessScore,
        executionAllowed: hasVisaRefusal ? false : riskResult.executionAllowed,
        riskLevel: riskResult.riskLevel,
        recommendedRoute: finalRoute,
        hardStop,
      };
    });

    // Send welcome email asynchronously (don't block on failure)
    this.mail.sendWelcomeEmail(data.email, data.fullName).catch(error => {
      console.error('[INTAKE] Welcome email failed, but proceeding:', error);
    });

    return intakeResult;
  } catch (error) {
      console.error('[INTAKE ERROR] Exception occurred:', error);
      if (error instanceof Error) {
        console.error('[INTAKE ERROR] Message:', error.message);
        console.error('[INTAKE ERROR] Stack:', error.stack);
      }
      throw error;
    }
  }

  async listProgrammes() {
    const rows = await this.prisma.educationProgramme.findMany({
      // PR-CATALOG-1 — identical visibility rule to the matcher: provider ACTIVE
      // AND programme APPROVED AND isActive. No silent inconsistency between the
      // two student-facing surfaces.
      where: { isActive: true, reviewStatus: ReviewStatus.APPROVED, provider: { status: 'ACTIVE' } },
      select: {
        id: true, name: true, intakeMonths: true,
        // PR-SLOTRULES — institutionType drives the Step-1 mandatory-position UX; isFeatured
        // is the Owner "Featured" pin (additive display only).
        provider: { select: { name: true, institutionType: true, isFeatured: true } },
      },
      orderBy: [{ provider: { name: 'asc' } }, { name: 'asc' }],
    });

    // PR-INTAKE-1 (Slice 2) — server-authoritative eligible intakes: only the
    // 5–12 month window is offered, so the client can never surface a sub-5-month
    // intake. Each carries a `conditional` flag (later calendar year → offer
    // conditional on the institution's acceptance).
    const cfg = await this.prisma.countryExecutionConfig.findUnique({
      where: { countryCode: 'NZ' },
      select: { intakeMinLeadMonths: true, intakeMaxWindowMonths: true },
    });
    const minLead = cfg?.intakeMinLeadMonths ?? 5;
    const maxWindow = cfg?.intakeMaxWindowMonths ?? 12;
    const now = new Date();

    return rows.map(r => ({
      id: r.id, name: r.name,
      providerName: r.provider.name,
      institutionType: r.provider.institutionType ?? null,
      isFeatured: r.provider.isFeatured,
      intakeMonths: r.intakeMonths, // kept for backward-compat
      eligibleIntakes: eligibleIntakes(r.intakeMonths, now, minLead, maxWindow)
        .map(i => ({ month: i.month, year: i.year, conditional: isConditionalOffer(i, now) })),
    }));
  }

  // PR-SLOTRULES — the Owner-configured mandatory institution-type rule for the Apply/Study
  // programme list, so Step 1 can show required positions live. Non-sensitive config; public
  // like the programme catalogue. Normalised to { enabled, mandatorySlots }.
  async programmeChoiceRules() {
    const row = await this.prisma.countryExecutionConfig.findUnique({
      where: { countryCode: 'NZ' },
      select: { slotRules: true },
    });
    const sr = row?.slotRules as unknown;
    if (!sr || typeof sr !== 'object' || Array.isArray(sr)) return { enabled: false, mandatorySlots: [] as Array<{ position: number; institutionType: string }> };
    const o = sr as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      mandatorySlots: Array.isArray(o.mandatorySlots) ? (o.mandatorySlots as Array<{ position: number; institutionType: string }>) : [],
    };
  }

  private determineRecommendedRoute(
    bandNumber: number,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED',
  ): RecommendedRoute {
    if (riskLevel === 'BLOCKED') {
      return RecommendedRoute.LIA_CONSULTATION;
    }

    if (bandNumber <= 2) return RecommendedRoute.CONTENT_NURTURE;
    if (bandNumber === 3) return RecommendedRoute.ROADMAP;
    if (bandNumber === 4) return RecommendedRoute.ADMISSION_CONSULTATION;
    return RecommendedRoute.EXECUTION_QUEUE; // band 5-6
  }
}
