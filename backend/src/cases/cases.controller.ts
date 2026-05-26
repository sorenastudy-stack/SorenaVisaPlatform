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
import { LiaAssignmentService } from './lia-assignment.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { CaseListQueryDto } from './dto/case-list-filter.dto';
import { OverrideRiskDto, ClearHardStopDto } from './dto/lia-actions.dto';
import { ManualReassignLiaDto } from './dto/lia-assignment.dto';

@Controller('cases')
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(
    private readonly casesService: CasesService,
    private readonly liaAssignments: LiaAssignmentService,
  ) {}

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
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  overrideRisk(
    @Param('id') id: string,
    @Body() dto: OverrideRiskDto,
    @Req() req: any,
  ) {
    return this.casesService.overrideRisk(id, dto, {
      // PR-LIA-1 latency bug: JwtStrategy.validate returns
      // { userId, email, role } — `req.user.id` is undefined. The
      // service writes `LegalNote.authorId` (required FK) from
      // actor.id, so the original `req.user?.id` crashed every
      // write with PrismaClientValidationError as soon as the role
      // gate let OWNER through (commit 8e20cb0). Match the pattern
      // used elsewhere in this file.
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  @Patch(':id/clear-hard-stop')
  @UseGuards(RolesGuard)
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  clearHardStop(
    @Param('id') id: string,
    @Body() dto: ClearHardStopDto,
    @Req() req: any,
  ) {
    return this.casesService.clearHardStop(id, dto, {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  // PR-LIA-2 — Manual LIA reassignment. OWNER / ADMIN / SUPER_ADMIN
  // only: an LIA cannot reassign their own case (would create a
  // hot-potato problem). Auto-assignment (on contract sign) is in
  // the contract webhook, not here.
  @Patch(':id/lia')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  reassignLia(
    @Param('id') id: string,
    @Body() dto: ManualReassignLiaDto,
    @Req() req: any,
  ) {
    return this.liaAssignments.manualReassign(
      id,
      { liaId: dto.liaId ?? null, reason: dto.reason },
      {
        id: req.user?.userId ?? req.user?.id,
        name: req.user?.name ?? null,
        role: req.user?.role ?? null,
      },
    );
  }
}
