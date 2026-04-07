import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { ScoringService } from '../scoring/scoring.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadStatus } from '@prisma/client';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private scoringService: ScoringService,
    private notificationsService: NotificationsService,
  ) {}

  async submitIntakeForm(data: {
    fullName: string;
    email: string;
    phone?: string;
    whatsapp?: string;
    destination: string;
    studyLevel: string;
    preferredLanguage: string;
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
    return this.prisma.$transaction(async (tx) => {
      // Create contact
      const contact = await tx.contact.create({
        data: {
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,
          whatsapp: data.whatsapp,
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
          preferredLevel: data.studyLevel,
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
        preferredLevel: data.studyLevel,
        preferredField: data.fieldOfStudy,
        completionPercent: 100,
      });

      // Update lead with score
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          scoreBand: scoreResult.scoreBand,
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
      );

      await this.eventsService.emit(
        'INTAKE_COMPLETED',
        'INTAKE',
        intakeForm.id,
        lead.id,
        'SYSTEM',
        null,
        scoreResult,
      );

      // Send welcome email
      await this.notificationsService.sendWelcomeEmail(data.email, data.fullName);

      return {
        leadId: lead.id,
        scoreBand: scoreResult.scoreBand,
        readinessScore: scoreResult.readinessScore,
      };
    });
  }
}