import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { StaffAdmissionTasksService } from './staff-admission-tasks.service';

// PR-INTAKE-1 (Slice 3) — Admission Officer task list.
@Controller('staff/admission-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class StaffAdmissionTasksController {
  constructor(private readonly service: StaffAdmissionTasksService) {}

  @Get()
  list(@Req() req: any, @Query('scope') scope?: string) {
    return this.service.list(req.user?.userId ?? req.user?.id, req.user?.role, scope);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @Req() req: any) {
    return this.service.resolve(id, req.user?.userId ?? req.user?.id);
  }
}
