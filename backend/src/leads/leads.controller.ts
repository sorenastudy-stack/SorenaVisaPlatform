import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LeadStatus } from '@prisma/client';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { UpdateLeadNotesDto } from './dto/update-lead-notes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

// The whole lead funnel is staff-only. This legacy /leads controller had just
// JwtAuthGuard (any authenticated user, incl. self-registered LEAD/STUDENT
// clients, could read/mutate the funnel). RolesGuard is now applied class-wide,
// and every route carries an explicit @Roles — reads/writes are gated to the
// funnel roles; notes/override stay SUPER_ADMIN-only. The modern equivalent is
// /staff/leads; the two now agree on entitlement.
const FUNNEL_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE'] as const;

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Post()
  @Roles(...FUNNEL_ROLES)
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  @Roles(...FUNNEL_ROLES)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  findAll(
    @Request() req,
    @Query('status') status?: string,
    @Query('scoreBand') scoreBand?: string,
    @Query('ownerId') ownerId?: string,
    @Query('isNurtureCandidate') isNurtureCandidate?: boolean,
  ) {
    return this.leadsService.findAll(
      { status, scoreBand, ownerId, isNurtureCandidate },
      { role: req.user?.role ?? null },
    );
  }

  @Get(':id')
  @Roles(...FUNNEL_ROLES)
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  @Roles(...FUNNEL_ROLES)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @Request() req,
  ) {
    return this.leadsService.updateStatus(id, dto, req.user.userId);
  }

  @Patch(':id/notes')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  updateNotes(
    @Param('id') id: string,
    @Body() dto: UpdateLeadNotesDto,
    @Request() req,
  ) {
    return this.leadsService.updateNotes(id, dto, req.user.userId, req.user.role);
  }

  @Post(':id/override')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  override(
    @Param('id') id: string,
    @Body() dto: { status: LeadStatus; reason: string },
    @Request() req,
  ) {
    return this.leadsService.overrideStatus(id, dto.status, dto.reason, req.user.userId);
  }

  @Post(':id/undo')
  @Roles(...FUNNEL_ROLES)
  undo(@Param('id') id: string, @Request() req) {
    return this.leadsService.undoLastChange(id, req.user.userId);
  }

  @Get(':id/history')
  @Roles(...FUNNEL_ROLES)
  history(@Param('id') id: string) {
    return this.leadsService.getHistory(id);
  }
}
