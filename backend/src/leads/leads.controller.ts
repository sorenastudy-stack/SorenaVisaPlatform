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
import { LeadStatus } from '@prisma/client';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { UpdateLeadNotesDto } from './dto/update-lead-notes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('leads')
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('scoreBand') scoreBand?: string,
    @Query('ownerId') ownerId?: string,
    @Query('isNurtureCandidate') isNurtureCandidate?: boolean,
  ) {
    return this.leadsService.findAll({
      status,
      scoreBand,
      ownerId,
      isNurtureCandidate,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
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
  undo(@Param('id') id: string, @Request() req) {
    return this.leadsService.undoLastChange(id, req.user.userId);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.leadsService.getHistory(id);
  }
}
