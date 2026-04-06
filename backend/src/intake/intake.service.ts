import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService, IntakeFormData } from '../scoring/scoring.service';
import { HighRiskEngineService } from '../scoring/high-risk-engine.service';
import { EventsService } from '../events/events.service';
import { CreateOrUpdateIntakeDto } from './dto/create-or-update-intake.dto';

@Injectable()
export class IntakeService {
  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    private riskEngine: HighRiskEngineService,
    private eventsService: EventsService,
  ) {}

  /**
   * Calculate completion percentage based on filled fields
   */
  private calculateCompletionPercent(data: Record<string, any>): number {
    const fields = [
      'highestQualification',
      'fieldOfStudy',
      'gpa',
      'englishTestType',
      'englishOverallScore',
      'financialLevel',
      'estimatedBudgetNZD',
      'visaHistory',
      'visaRejectionCount',
      'workExperienceYears',
      'studyIntent',
      'preferredStartDate',
      'preferredLevel',
      'preferredField',
    ];

    const filledCount = fields.filter((field) => data[field] != null).length;
    return Math.round((filledCount / fields.length) * 100);
  }

  /**
   * Create or update intake form for a lead
   */
  async createOrUpdateIntake(leadId: string, dto: CreateOrUpdateIntakeDto) {
    // Verify lead exists
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // Calculate completion percentage
    const completionPercent = this.calculateCompletionPercent(dto);

    // Find or create intake form
    let intakeForm = await this.prisma.intakeForm.findUnique({
      where: { leadId },
    });

    const intakeData = {
      ...dto,
      completionPercent,
      englishComponentScores: dto.englishComponentScores || null,
      preferredStartDate: dto.preferredStartDate
        ? dto.preferredStartDate.toISOString().split('T')[0]
        : null,
    };

    if (intakeForm) {
      // Update existing
      intakeForm = await this.prisma.intakeForm.update({
        where: { leadId },
        data: intakeData,
      });
    } else {
      // Create new
      intakeForm = await this.prisma.intakeForm.create({
        data: {
          ...intakeData,
          leadId,
        },
      });
    }

    // Trigger scoring engine
    await this.scoreAndUpdateLead(leadId, null);

    return intakeForm;
  }

  /**
   * Score the lead and update its scoring fields
   */
  async scoreAndUpdateLead(leadId: string, actorId: string | null) {
    const intakeForm = await this.prisma.intakeForm.findUnique({
      where: { leadId },
    });

    if (!intakeForm) {
      throw new NotFoundException('Intake form not found for this lead');
    }

    // Prepare intake data for scoring
    const intakeData: IntakeFormData = {
      highestQualification: intakeForm.highestQualification,
      fieldOfStudy: intakeForm.fieldOfStudy,
      gpa: intakeForm.gpa,
      englishTestType: intakeForm.englishTestType,
      englishOverallScore: intakeForm.englishOverallScore,
      financialLevel: intakeForm.financialLevel,
      estimatedBudgetNZD: intakeForm.estimatedBudgetNZD,
      visaHistory: intakeForm.visaHistory,
      visaRejectionCount: intakeForm.visaRejectionCount,
      visaRejectionReason: intakeForm.visaRejectionReason,
      workExperienceYears: intakeForm.workExperienceYears,
      studyIntent: intakeForm.studyIntent,
      preferredStartDate: intakeForm.preferredStartDate
        ? new Date(intakeForm.preferredStartDate)
        : undefined,
      preferredLevel: intakeForm.preferredLevel,
      preferredField: intakeForm.preferredField,
      completionPercent: intakeForm.completionPercent,
    };

    // Calculate scores
    const scoreResult = this.scoringService.calculateScores(intakeData);

    // Assess risk
    const riskResult = this.riskEngine.assessRisk(intakeData, scoreResult.scoreBand);

    // Determine recommended route
    const recommendedRoute = this.determineRecommendedRoute(
      scoreResult.scoreBand,
      riskResult.riskLevel,
    );

    // Update lead with all scores
    const updatedLead = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        readinessScore: scoreResult.readinessScore,
        academicScore: scoreResult.academicScore,
        financialScore: scoreResult.financialScore,
        englishScore: scoreResult.englishScore,
        intentScore: scoreResult.intentScore,
        engagementScore: scoreResult.engagementScore,
        scoreBand: scoreResult.scoreBand as any,
        riskLevel: riskResult.riskLevel as any,
        hardStopFlag: riskResult.hardStopFlag,
        hardStopReason: riskResult.hardStopReason,
        executionAllowed: riskResult.executionAllowed,
        recommendedRoute: recommendedRoute as any,
      },
      include: { contact: true },
    });

    // Emit scoring completed event
    await this.eventsService.emit(
      'SCORING_COMPLETED',
      'LEAD',
      leadId,
      leadId,
      'SYSTEM',
      actorId,
      {
        scores: scoreResult,
        risk: riskResult,
        recommendedRoute,
      },
    );

    return updatedLead;
  }

  /**
   * Get current scores for a lead
   */
  async getScores(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        readinessScore: true,
        academicScore: true,
        financialScore: true,
        englishScore: true,
        intentScore: true,
        engagementScore: true,
        scoreBand: true,
        riskLevel: true,
        hardStopFlag: true,
        hardStopReason: true,
        executionAllowed: true,
        recommendedRoute: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  /**
   * Determine recommended route based on score and risk
   */
  private determineRecommendedRoute(
    scoreBand: 'LOW' | 'MID' | 'HIGH',
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED',
  ): string {
    if (riskLevel === 'BLOCKED') {
      return 'LIA_CONSULTATION'; // Needs manual review
    }

    if (scoreBand === 'HIGH') {
      if (riskLevel === 'LOW') {
        return 'EXECUTION_QUEUE'; // Ready to execute
      } else {
        return 'SPECIALIST_CONSULTATION'; // High score but flagged
      }
    }

    if (scoreBand === 'MID') {
      if (riskLevel === 'LOW') {
        return 'ADMISSION_CONSULTATION';
      } else {
        return 'WEBINAR'; // Build engagement
      }
    }

    // LOW score
    return 'CONTENT_NURTURE'; // Nurture for later
  }
}
