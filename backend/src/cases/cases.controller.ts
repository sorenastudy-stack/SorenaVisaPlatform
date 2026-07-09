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
import { ManualReassignOwnerDto } from './dto/owner-assignment.dto';
import { ManualReassignSupportDto } from './dto/support-assignment.dto';
import { ManualReassignFinanceDto } from './dto/finance-assignment.dto';
import { ManualReassignConsultantDto } from './dto/consultant-assignment.dto';

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

  // PR-OPS-CASES — was guarded by JwtAuthGuard only (any authenticated user
  // could edit a case). Now role-gated: admin tier + OPERATIONS. OPERATIONS
  // edits stage/notes via UpdateCaseDto; reassignment + risk/legal stay on the
  // dedicated routes below (which exclude OPERATIONS).
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'OPERATIONS')
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

  // Option 1 step 3a — Mirror of /lia for the CONSULTANT ("Admission
  // Specialist") slot, which lives on Case.ownerId. Same guard set,
  // same actor extraction, same DTO shape (ownerId + reason).
  @Patch(':id/owner')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  reassignOwner(
    @Param('id') id: string,
    @Body() dto: ManualReassignOwnerDto,
    @Req() req: any,
  ) {
    return this.liaAssignments.reassignOwner(
      id,
      { ownerId: dto.ownerId ?? null, reason: dto.reason },
      {
        id: req.user?.userId ?? req.user?.id,
        name: req.user?.name ?? null,
        role: req.user?.role ?? null,
      },
    );
  }

  // Option 1 step 4b — Mirror of /lia for the SUPPORT slot, which
  // lives on Case.supportId. Same guard set, same actor extraction.
  @Patch(':id/support')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  reassignSupport(
    @Param('id') id: string,
    @Body() dto: ManualReassignSupportDto,
    @Req() req: any,
  ) {
    return this.liaAssignments.reassignSupport(
      id,
      { supportId: dto.supportId ?? null, reason: dto.reason },
      {
        id: req.user?.userId ?? req.user?.id,
        name: req.user?.name ?? null,
        role: req.user?.role ?? null,
      },
    );
  }

  // Option 1 step 4b — Mirror of /lia for the FINANCE slot, which
  // lives on Case.financeId. Same guard set, same actor extraction.
  @Patch(':id/finance')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  reassignFinance(
    @Param('id') id: string,
    @Body() dto: ManualReassignFinanceDto,
    @Req() req: any,
  ) {
    return this.liaAssignments.reassignFinance(
      id,
      { financeId: dto.financeId ?? null, reason: dto.reason },
      {
        id: req.user?.userId ?? req.user?.id,
        name: req.user?.name ?? null,
        role: req.user?.role ?? null,
      },
    );
  }

  // Phase 1 (auto-assignment) — Mirror of /support for the CONSULTANT slot,
  // which lives on Case.consultantId. Admin-tier only for manual override;
  // validates the target's role is CLIENT_CONSULTANT in the service.
  @Patch(':id/consultant')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  reassignConsultant(
    @Param('id') id: string,
    @Body() dto: ManualReassignConsultantDto,
    @Req() req: any,
  ) {
    return this.liaAssignments.reassignConsultant(
      id,
      { consultantId: dto.consultantId ?? null, reason: dto.reason },
      {
        id: req.user?.userId ?? req.user?.id,
        name: req.user?.name ?? null,
        role: req.user?.role ?? null,
      },
    );
  }
}
