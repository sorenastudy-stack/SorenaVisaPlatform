import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClaudeService } from '../claude.service';
import { ComplianceGuardService } from '../compliance-guard.service';
import { EventsService, EventSource } from '../../events/events.service';

@Injectable()
export class LeadQualificationAgent {
  constructor(
    private prisma: PrismaService,
    private claudeService: ClaudeService,
    private complianceGuard: ComplianceGuardService,
    private eventsService: EventsService,
  ) {}

  async qualify(leadId: string): Promise<string> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contact: true,
        intakeForm: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const intake = lead.intakeForm;
    const leadData = this.formatLeadData(lead, intake);
    const systemPrompt =
      'You are an internal lead qualification assistant for Sorena Visa. Use available lead and intake details to summarize the lead qualification status, risks, and recommended next steps. Do not provide immigration advice, eligibility assessments, or visa guarantees.';
    const userPrompt = `Evaluate the following lead:\n\n${leadData}`;

    const responseText = await this.claudeService.chat(systemPrompt, userPrompt);
    const scanned = this.complianceGuard.scan(responseText);
    const finalText = scanned === responseText
      ? this.complianceGuard.injectDisclaimer(responseText)
      : scanned;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { aiSummary: finalText },
    });

    await this.eventsService.emit(
      'LEAD_QUALIFIED',
      'LEAD',
      leadId,
      leadId,
      EventSource.SYSTEM,
      null,
      { leadId, summaryLength: finalText.length },
    );

    return finalText;
  }

  private formatLeadData(lead: any, intake: any) {
    const lines: string[] = [];
    lines.push(`Lead ID: ${lead.id}`);
    lines.push(`Lead status: ${lead.leadStatus}`);
    lines.push(`Contact: ${lead.contact?.fullName ?? 'N/A'}`);
    lines.push(`Email: ${lead.contact?.email ?? 'N/A'}`);
    lines.push(`Phone: ${lead.contact?.phone ?? 'N/A'}`);

    if (intake) {
      lines.push('Intake form data:');
      lines.push(`- Highest qualification: ${intake.highestQualification ?? 'N/A'}`);
      lines.push(`- Field of study: ${intake.fieldOfStudy ?? 'N/A'}`);
      lines.push(`- GPA: ${intake.gpa ?? 'N/A'}`);
      lines.push(`- English test type: ${intake.englishTestType ?? 'N/A'}`);
      lines.push(`- English overall score: ${intake.englishOverallScore ?? 'N/A'}`);
      lines.push(`- Financial level: ${intake.financialLevel ?? 'N/A'}`);
      lines.push(`- Estimated budget NZD: ${intake.estimatedBudgetNZD ?? 'N/A'}`);
      lines.push(`- Visa history: ${intake.visaHistory ?? 'N/A'}`);
      lines.push(`- Visa rejection count: ${intake.visaRejectionCount ?? 0}`);
      lines.push(`- Work experience years: ${intake.workExperienceYears ?? 'N/A'}`);
      lines.push(`- Study intent: ${intake.studyIntent ?? 'N/A'}`);
      lines.push(`- Preferred start date: ${intake.preferredStartDate ?? 'N/A'}`);
      lines.push(`- Preferred level: ${intake.preferredLevel ?? 'N/A'}`);
      lines.push(`- Preferred field: ${intake.preferredField ?? 'N/A'}`);
      lines.push(`- Intake completion: ${intake.completionPercent ?? 0}%`);
    } else {
      lines.push('Intake form data: None');
    }

    return lines.join('\n');
  }
}
