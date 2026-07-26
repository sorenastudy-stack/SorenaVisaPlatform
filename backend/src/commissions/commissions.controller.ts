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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CommissionsService } from './commissions.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';
import { UpdateReminderDateDto } from './dto/update-reminder-date.dto';
import { CommissionListQueryDto } from './dto/commission-list-filter.dto';

// PR-COMMISSIONS-UI — institutional/provider commission ledger. Gating aligned to
// the money-managing tier (OWNER + FINANCE, + SUPER_ADMIN escape hatch), replacing
// the legacy OPERATIONS-centric roles (OPERATIONS is being retired and no active
// frontend consumed these routes). Business logic is UNCHANGED. Exception: creating
// a commission (`POST /`) reads the enrolment applications, whose endpoints are
// admissions-tier gated (not FINANCE), so record stays OWNER/SUPER_ADMIN; FINANCE
// does the view + money lifecycle (confirm → invoice → pay) + reminders.
@Controller('commissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Post()
  @Roles('OWNER', 'SUPER_ADMIN')
  create(@Body() dto: CreateCommissionDto) {
    return this.commissionsService.createCommission(dto);
  }

  @Post(':id/confirm')
  @Roles('OWNER', 'SUPER_ADMIN', 'FINANCE')
  confirm(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.commissionsService.confirmCommission(
      id,
      req.user?.id ?? null,
      req.user?.role,
    );
  }

  @Patch(':id/reminder-date')
  @Roles('OWNER', 'SUPER_ADMIN', 'FINANCE')
  updateReminderDate(
    @Param('id') id: string,
    @Body() dto: UpdateReminderDateDto,
    @Req() req: any,
  ) {
    return this.commissionsService.updateReminderDate(id, dto, req.user?.role);
  }

  // Role-gated at the controller AND enforced again in the service (money data).
  // Commissions have no per-user owner, so this is a role gate, not per-user
  // scoping — the entitled tier sees the ledger, everyone else is refused.
  @Get()
  @Roles('OWNER', 'SUPER_ADMIN', 'FINANCE')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  findAll(@Query() query: CommissionListQueryDto, @Req() req: any) {
    return this.commissionsService.findAll(query, {
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  @Patch(':id/status')
  @Roles('OWNER', 'SUPER_ADMIN', 'FINANCE')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionStatusDto,
  ) {
    return this.commissionsService.updateStatus(id, dto);
  }
}
