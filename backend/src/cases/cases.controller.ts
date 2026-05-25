import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CasesService } from './cases.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { CaseListQueryDto } from './dto/case-list-filter.dto';
import { OverrideRiskDto, ClearHardStopDto } from './dto/lia-actions.dto';

@Controller('cases')
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Post()
  create(@Body() dto: CreateCaseDto, @Req() req: any) {
    return this.casesService.createCase(dto, req.user?.id ?? null);
  }

  @Get()
  findAll(@Query() query: CaseListQueryDto) {
    return this.casesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.casesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCaseDto) {
    return this.casesService.updateCase(id, dto);
  }

  // ─── PR-LIA-1 — LIA-only override actions ────────────────────────────
  //
  // RolesGuard is applied per-route (not class-wide) so we don't break
  // the other routes' broader access. Only LIA / ADMIN / SUPER_ADMIN
  // can touch these.

  @Patch(':id/risk')
  @UseGuards(RolesGuard)
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN')
  overrideRisk(
    @Param('id') id: string,
    @Body() dto: OverrideRiskDto,
    @Req() req: any,
  ) {
    return this.casesService.overrideRisk(id, dto, {
      id: req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  @Patch(':id/clear-hard-stop')
  @UseGuards(RolesGuard)
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN')
  clearHardStop(
    @Param('id') id: string,
    @Body() dto: ClearHardStopDto,
    @Req() req: any,
  ) {
    return this.casesService.clearHardStop(id, dto, {
      id: req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }
}
