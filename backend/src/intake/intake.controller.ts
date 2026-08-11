import { Controller, Post, Get, Param, Body, UseGuards, Req } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CreateOrUpdateIntakeDto } from './dto/create-or-update-intake.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { assertLeadReadable } from '../leads/assert-lead-read';

// Lead intake + scoring are part of the funnel. Both controllers were
// JwtAuthGuard-only → any authenticated user could read a lead's scoring
// profile (readiness/financial/risk band) or trigger scoring by leadId. Gated
// to the same funnel roles as /leads.
//
// PR-ACCESS-AUDIT — the role gate was only half the answer. It said who may
// reach intake at all; it did not say WHICH lead, so a scoped role could pass
// any leadId and read a colleague's client's financial capacity and risk band.
// assertLeadReadable applies the same ownership rule /leads/:id applies.
//
// The role list is LeadsService.FUNNEL_ROLES rather than a copy of it. The last
// copy of this list drifted from the original and left a role that the page
// admitted being refused by the endpoint — a bug no unit test could see.
const FUNNEL_ROLES = LeadsService.FUNNEL_ROLES;

/** The actor shape the lead-ownership rule expects, from the JWT. */
function actorOf(req: any) {
  return {
    id: req?.user?.userId ?? req?.user?.id ?? null,
    role: req?.user?.role ?? null,
    secondaryRoles: req?.user?.secondaryRoles ?? [],
  };
}

@Controller('intake')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntakeController {
  constructor(
    private intakeService: IntakeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':leadId')
  @Roles(...FUNNEL_ROLES)
  async createOrUpdateIntake(
    @Param('leadId') leadId: string,
    @Body() dto: CreateOrUpdateIntakeDto,
    @Req() req: any,
  ) {
    await assertLeadReadable(this.prisma, leadId, actorOf(req));
    return this.intakeService.createOrUpdateIntake(leadId, dto);
  }
}

@Controller('scoring')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScoringController {
  constructor(
    private intakeService: IntakeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':leadId')
  @Roles(...FUNNEL_ROLES)
  async triggerScoring(
    @Param('leadId') leadId: string,
    @Req() req,
  ) {
    await assertLeadReadable(this.prisma, leadId, actorOf(req));
    return this.intakeService.scoreAndUpdateLead(leadId, req.user.userId);
  }

  @Get(':leadId')
  @Roles(...FUNNEL_ROLES)
  async getScores(@Param('leadId') leadId: string, @Req() req: any) {
    await assertLeadReadable(this.prisma, leadId, actorOf(req));
    return this.intakeService.getScores(leadId);
  }
}
