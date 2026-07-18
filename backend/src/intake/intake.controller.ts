import { Controller, Post, Get, Param, Body, UseGuards, Req } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CreateOrUpdateIntakeDto } from './dto/create-or-update-intake.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Lead intake + scoring are part of the funnel. Both controllers were
// JwtAuthGuard-only → any authenticated user could read a lead's scoring
// profile (readiness/financial/risk band) or trigger scoring by leadId. Gated
// to the same funnel roles as /leads.
const FUNNEL_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE'] as const;

@Controller('intake')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntakeController {
  constructor(private intakeService: IntakeService) {}

  @Post(':leadId')
  @Roles(...FUNNEL_ROLES)
  async createOrUpdateIntake(
    @Param('leadId') leadId: string,
    @Body() dto: CreateOrUpdateIntakeDto,
  ) {
    return this.intakeService.createOrUpdateIntake(leadId, dto);
  }
}

@Controller('scoring')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScoringController {
  constructor(private intakeService: IntakeService) {}

  @Post(':leadId')
  @Roles(...FUNNEL_ROLES)
  async triggerScoring(
    @Param('leadId') leadId: string,
    @Req() req,
  ) {
    return this.intakeService.scoreAndUpdateLead(leadId, req.user.userId);
  }

  @Get(':leadId')
  @Roles(...FUNNEL_ROLES)
  async getScores(@Param('leadId') leadId: string) {
    return this.intakeService.getScores(leadId);
  }
}
