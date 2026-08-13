import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { STAFF_PORTAL_ROLES } from '../staff/roles/staff-roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { assertLeadReadable } from '../leads/assert-lead-read';
import { ChatRequestDto } from './dto/chat.dto';
import { ClaudeService } from './claude.service';
import { ComplianceGuardService } from './compliance-guard.service';
import { LeadQualificationAgent } from './agents/lead-qualification.agent';

// PR-AI-GATE — these two routes were authenticated but not authorised.
//
// `JwtAuthGuard` alone means "any account with a valid token", which is every
// staff member, every STUDENT and every LEAD — and, once the agent portal
// exists, every external agent. `qualify` took a lead id straight from the URL
// and returned that lead's contact details and intake answers summarised by an
// LLM, then wrote back to the row. So any signed-in client could read the
// personal details of any lead in the business by iterating ids.
//
// Two separate problems, so two separate fixes:
//   - WHO may ask at all      -> the role gate below
//   - WHICH leads they may ask about -> assertLeadReadable, the same ownership
//     rule the funnel itself uses, so a SALES rep cannot qualify somebody
//     else's lead any more than they can open it
//
// `chat` needs no ownership check — it carries no record — but it does spend
// money on every call, so it is staff-only rather than open to any token.
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly leadQualificationAgent: LeadQualificationAgent,
    private readonly claudeService: ClaudeService,
    private readonly complianceGuard: ComplianceGuardService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id ?? null,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
    };
  }

  /**
   * Qualify one lead.
   *
   * FUNNEL_ROLES is who works leads at all; `assertLeadReadable` then narrows
   * that to the leads this particular caller may see — NOT FOUND, not
   * FORBIDDEN, so the response never confirms a lead the caller is not
   * entitled to know exists.
   */
  @Post('qualify/:leadId')
  @Roles(...LeadsService.FUNNEL_ROLES)
  async qualify(@Param('leadId') leadId: string, @Req() req: any) {
    await assertLeadReadable(this.prisma, leadId, this.actor(req));
    return this.leadQualificationAgent.qualify(leadId);
  }

  @Post('chat')
  @Roles(...STAFF_PORTAL_ROLES)
  async chat(@Body() dto: ChatRequestDto) {
    const systemPrompt =
      'You are an assistant for Sorena Visa. Answer user questions clearly and helpfully without providing immigration advice or visa eligibility determinations.';
    const responseText = await this.claudeService.chat(systemPrompt, dto.message);
    const scanned = await this.complianceGuard.scan(responseText);
    return scanned === responseText
      ? this.complianceGuard.injectDisclaimer(responseText)
      : scanned;
  }
}
