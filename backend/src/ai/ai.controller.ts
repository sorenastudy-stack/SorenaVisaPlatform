import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatRequestDto } from './dto/chat.dto';
import { ClaudeService } from './claude.service';
import { ComplianceGuardService } from './compliance-guard.service';
import { LeadQualificationAgent } from './agents/lead-qualification.agent';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly leadQualificationAgent: LeadQualificationAgent,
    private readonly claudeService: ClaudeService,
    private readonly complianceGuard: ComplianceGuardService,
  ) {}

  @Post('qualify/:leadId')
  async qualify(@Param('leadId') leadId: string) {
    return this.leadQualificationAgent.qualify(leadId);
  }

  @Post('chat')
  async chat(@Body() dto: ChatRequestDto) {
    const systemPrompt =
      'You are an assistant for Sorena Visa. Answer user questions clearly and helpfully without providing immigration advice or visa eligibility determinations.';
    const responseText = await this.claudeService.chat(systemPrompt, dto.message);
    const scanned = this.complianceGuard.scan(responseText);
    return scanned === responseText
      ? this.complianceGuard.injectDisclaimer(responseText)
      : scanned;
  }
}
