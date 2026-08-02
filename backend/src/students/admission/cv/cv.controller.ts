import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CvService } from './cv.service';

// PR-ADMISSION-CV (step 2b) — Admission Specialist CV generate/review/edit/approve on the Case
// File. Case-scoped, same curator-tier guard as the other /staff/cases/:caseId/* surfaces.
@Controller('staff/cases/:caseId/cv')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT')
export class CvController {
  constructor(private readonly service: CvService) {}

  private actorId(req: any): string | null {
    return req.user?.userId ?? req.user?.id ?? null;
  }

  @Get()
  getCurrent(@Param('caseId') caseId: string) {
    return this.service.getCurrent(caseId);
  }

  @Post('generate')
  generate(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.generate(caseId, this.actorId(req));
  }

  @Patch(':cvId')
  update(@Param('caseId') caseId: string, @Param('cvId') cvId: string, @Body() body: { content: unknown }) {
    return this.service.update(caseId, cvId, body?.content);
  }

  @Post(':cvId/approve')
  approve(@Param('caseId') caseId: string, @Param('cvId') cvId: string, @Req() req: any) {
    return this.service.approve(caseId, cvId, this.actorId(req));
  }
}
