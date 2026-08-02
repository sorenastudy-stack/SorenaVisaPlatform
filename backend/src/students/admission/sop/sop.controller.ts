import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { SopService } from './sop.service';

// PR-ADMISSION-SOP (step 3) — Admission Specialist SOP generate/review/edit/evaluate/approve on
// the Case File. One SOP per submitted programme choice. Same curator-tier guard + case scoping as
// the other /staff/cases/:caseId/* surfaces (CV, etc.).
@Controller('staff/cases/:caseId/sop')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT')
export class SopController {
  constructor(private readonly service: SopService) {}

  private actorId(req: any): string | null {
    return req.user?.userId ?? req.user?.id ?? null;
  }

  @Get()
  list(@Param('caseId') caseId: string) {
    return this.service.list(caseId);
  }

  @Post('generate-all')
  generateAll(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.generateAll(caseId, this.actorId(req));
  }

  @Post('choices/:choiceId/generate')
  generate(@Param('caseId') caseId: string, @Param('choiceId') choiceId: string, @Req() req: any) {
    return this.service.generate(caseId, choiceId, this.actorId(req));
  }

  @Post(':sopId/evaluate')
  evaluate(@Param('caseId') caseId: string, @Param('sopId') sopId: string) {
    return this.service.evaluate(caseId, sopId);
  }

  @Patch(':sopId')
  update(@Param('caseId') caseId: string, @Param('sopId') sopId: string, @Body() body: { content: unknown }) {
    return this.service.update(caseId, sopId, body?.content);
  }

  @Post(':sopId/approve')
  approve(@Param('caseId') caseId: string, @Param('sopId') sopId: string, @Req() req: any) {
    return this.service.approve(caseId, sopId, this.actorId(req));
  }
}
