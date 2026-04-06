import { Controller, Post, Get, Param, Body, UseGuards, Req } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CreateOrUpdateIntakeDto } from './dto/create-or-update-intake.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('intake')
@UseGuards(JwtAuthGuard)
export class IntakeController {
  constructor(private intakeService: IntakeService) {}

  @Post(':leadId')
  async createOrUpdateIntake(
    @Param('leadId') leadId: string,
    @Body() dto: CreateOrUpdateIntakeDto,
  ) {
    return this.intakeService.createOrUpdateIntake(leadId, dto);
  }
}

@Controller('scoring')
@UseGuards(JwtAuthGuard)
export class ScoringController {
  constructor(private intakeService: IntakeService) {}

  @Post(':leadId')
  async triggerScoring(
    @Param('leadId') leadId: string,
    @Req() req,
  ) {
    return this.intakeService.scoreAndUpdateLead(leadId, req.user.userId);
  }

  @Get(':leadId')
  async getScores(@Param('leadId') leadId: string) {
    return this.intakeService.getScores(leadId);
  }
}
