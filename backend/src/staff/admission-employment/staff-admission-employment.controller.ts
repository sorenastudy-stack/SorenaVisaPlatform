import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { StaffAdmissionEmploymentService } from './staff-admission-employment.service';

// PR-ADMISSION-CVDATA (step 2a) — Admission Specialist view/edit of the client's employment
// history on the Case File. Case-scoped, curator-tier (same guard pattern as
// staff-admission-choices). No DRAFT lock — staff can correct at any stage.
@Controller('staff/cases/:caseId/employment-entries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class StaffAdmissionEmploymentController {
  constructor(private readonly service: StaffAdmissionEmploymentService) {}

  @Get()
  list(@Param('caseId') caseId: string) {
    return this.service.list(caseId);
  }

  @Post()
  add(@Param('caseId') caseId: string, @Body() body: any) {
    return this.service.add(caseId, body);
  }

  @Patch(':entryId')
  update(@Param('caseId') caseId: string, @Param('entryId') entryId: string, @Body() body: any) {
    return this.service.update(caseId, entryId, body);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('caseId') caseId: string, @Param('entryId') entryId: string) {
    return this.service.remove(caseId, entryId);
  }
}
