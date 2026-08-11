import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCaseReadable } from '../../cases/assert-case-read';
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
  constructor(private readonly service: StaffAdmissionEmploymentService, private readonly prisma: PrismaService) {}

  // Every method, not just the reads. Writing employment history onto someone
  // else's case is worse than reading it, and a role gate alone allowed both.
  private viewer(req: any) {
    return { userId: req.user?.userId ?? req.user?.id, role: req.user?.role };
  }

  @Get()
  async list(@Param('caseId') caseId: string, @Req() req: any) {
    await assertCaseReadable(this.prisma, caseId, this.viewer(req));
    return this.service.list(caseId);
  }

  @Post()
  async add(@Param('caseId') caseId: string, @Body() body: any, @Req() req: any) {
    await assertCaseReadable(this.prisma, caseId, this.viewer(req));
    return this.service.add(caseId, body);
  }

  @Patch(':entryId')
  async update(
    @Param('caseId') caseId: string,
    @Param('entryId') entryId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    await assertCaseReadable(this.prisma, caseId, this.viewer(req));
    return this.service.update(caseId, entryId, body);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('caseId') caseId: string, @Param('entryId') entryId: string, @Req() req: any) {
    await assertCaseReadable(this.prisma, caseId, this.viewer(req));
    return this.service.remove(caseId, entryId);
  }
}
