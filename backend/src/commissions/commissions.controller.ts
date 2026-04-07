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
import { CommissionsService } from './commissions.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';
import { UpdateReminderDateDto } from './dto/update-reminder-date.dto';
import { CommissionListQueryDto } from './dto/commission-list-filter.dto';

@Controller('commissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Post()
  create(@Body() dto: CreateCommissionDto) {
    return this.commissionsService.createCommission(dto);
  }

  @Post(':id/confirm')
  @Roles('OPERATIONS', 'SUPER_ADMIN')
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
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateReminderDate(
    @Param('id') id: string,
    @Body() dto: UpdateReminderDateDto,
    @Req() req: any,
  ) {
    return this.commissionsService.updateReminderDate(id, dto, req.user?.role);
  }

  @Get()
  findAll(@Query() query: CommissionListQueryDto) {
    return this.commissionsService.findAll(query);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionStatusDto,
  ) {
    return this.commissionsService.updateStatus(id, dto);
  }
}
