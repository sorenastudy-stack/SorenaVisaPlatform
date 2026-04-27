import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { ScoringService } from '../scoring/scoring.service';
import { HighRiskEngineService } from '../scoring/high-risk-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadStatus, RecommendedRoute } from '@prisma/client';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private scoringService: ScoringService,
    private riskEngine: HighRiskEngineService,
    private notificationsService: NotificationsService,
  ) {}

  async submitIntakeForm(data: {
    fullName: string;
    email: string;
    phone?: string;
    whatsapp?: string;
    destination: string;
    nationality?: string;
    preferredLevel: string;
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
      const contact = data.email
        ? await tx.contact.upsert({
            where: { email: data.email },
            update: {
              fullName: data.fullName,
              phone: data.phone,
              whatsapp: data.whatsapp,
              nationality: data.nationality,
              preferredLanguage: data.preferredLanguage || undefined,
              countryOfResidence: data.destination || undefined,
            },
            create: {
              fullName: data.fullName,
              email: data.email,
              phone: data.phone,
              whatsapp: data.whatsapp,
              nationality: data.nationality,
              preferredLanguage: data.preferredLanguage || 'en',
              countryOfResidence: data.destination,
            },
          })
        : await tx.contact.create({
            data: {
              fullName: data.fullName,
              phone: data.phone,
              whatsapp: data.whatsapp,
              nationality: data.nationality,
              preferredLanguage: data.preferredLanguage || 'en',
              countryOfResidence: data.destination,
            },
          });

      // Create lead
      const lead = await tx.lead.create({
        data: {
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
    this.notificationsService.sendWelcomeEmail(data.email, data.fullName).catch(error => {
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