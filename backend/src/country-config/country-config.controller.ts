import {
  Body, Controller, Get, Param, Patch, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CountryConfigService } from './country-config.service';
import {
  UpdateAIConfigDto, UpdateAgentConfigDto, UpdateExecutionConfigDto,
} from './dto/country-config.dto';

// PR-OWNER-1 (slice a) — Owner-level per-country config endpoints.
//
// Mounted under /staff/settings/country-config/* (matching /staff/settings/sla).
//   • Reads  — OWNER + SUPER_ADMIN (transparency: super-admin may view config
//              that governs the platform, but not change it).
//   • Writes — OWNER only. Every write is audit-logged in the service.
//
// The prompt-governance review workflow is intentionally NOT enforced here (no
// Compliance Admin role exists). If added later it reuses OwnerApprovalRequest.
// Actor resolved via req.user?.userId ?? req.user?.id, per the platform-settings
// convention (d95640d).

@Controller('staff/settings/country-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CountryConfigController {
  constructor(private readonly service: CountryConfigService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN')
  list() {
    return this.service.listCountries();
  }

  @Get(':countryCode')
  @Roles('OWNER', 'SUPER_ADMIN')
  detail(@Param('countryCode') countryCode: string) {
    return this.service.getCountry(countryCode);
  }

  @Patch(':countryCode/execution')
  @Roles('OWNER')
  updateExecution(
    @Param('countryCode') countryCode: string,
    @Body() dto: UpdateExecutionConfigDto,
    @Req() req: any,
  ) {
    return this.service.updateExecution(countryCode, dto, this.actor(req));
  }

  @Patch(':countryCode/ai')
  @Roles('OWNER')
  updateAI(
    @Param('countryCode') countryCode: string,
    @Body() dto: UpdateAIConfigDto,
    @Req() req: any,
  ) {
    return this.service.updateAIConfig(countryCode, dto, this.actor(req));
  }

  @Patch(':countryCode/ai/agents/:agentType')
  @Roles('OWNER')
  updateAgent(
    @Param('countryCode') countryCode: string,
    @Param('agentType') agentType: string,
    @Body() dto: UpdateAgentConfigDto,
    @Req() req: any,
  ) {
    return this.service.updateAgent(countryCode, agentType, dto, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
