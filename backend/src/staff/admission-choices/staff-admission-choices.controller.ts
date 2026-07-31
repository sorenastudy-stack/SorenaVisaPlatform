import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { StaffAdmissionChoicesService } from './staff-admission-choices.service';
import { StaffAddChoiceDto, StaffReorderChoicesDto } from './dto/staff-admission-choices.dto';

// PR-ADMISSION-SHARED — Admission Officer CRUD over the student's shared
// programme-choice list. Case-scoped, CONSULTANT-tier (same guard pattern as the
// other /staff/cases/:caseId/* surfaces). Every mutation notifies the student via
// a ticket + records case history (in the service).
@Controller('staff/cases/:caseId/programme-choices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class StaffAdmissionChoicesController {
  constructor(private readonly service: StaffAdmissionChoicesService) {}

  @Get()
  list(@Param('caseId') caseId: string) {
    return this.service.list(caseId);
  }

  @Post()
  add(@Param('caseId') caseId: string, @Body() dto: StaffAddChoiceDto, @Req() req: any) {
    return this.service.add(caseId, dto, this.actor(req));
  }

  @Delete(':choiceId')
  remove(@Param('caseId') caseId: string, @Param('choiceId') choiceId: string, @Req() req: any) {
    return this.service.remove(caseId, choiceId, this.actor(req));
  }

  @Patch('reorder')
  reorder(@Param('caseId') caseId: string, @Body() dto: StaffReorderChoicesDto, @Req() req: any) {
    return this.service.reorder(caseId, dto.orderedIds, this.actor(req));
  }

  private actor(req: any) {
    return { id: req.user?.userId ?? req.user?.id ?? null, name: req.user?.name ?? null, role: req.user?.role ?? null };
  }
}
