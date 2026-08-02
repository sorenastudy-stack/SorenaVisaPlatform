import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { SubmissionService } from './submission.service';
import type { SubmissionInput } from './submission.logic';

// PR-ADMISSION-SUBMIT (step 4) — per-institution Submission Log on the Case File. Append-only
// attempts + response completion. Same curator-tier guard + case scoping as the CV/SOP surfaces.
@Controller('staff/cases/:caseId/submissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT')
export class SubmissionController {
  constructor(private readonly service: SubmissionService) {}

  private actorId(req: any): string | null {
    return req.user?.userId ?? req.user?.id ?? null;
  }

  @Get()
  list(@Param('caseId') caseId: string) {
    return this.service.list(caseId);
  }

  @Post()
  create(@Param('caseId') caseId: string, @Body() body: SubmissionInput & { choiceId: string }, @Req() req: any) {
    return this.service.create(caseId, body, this.actorId(req));
  }

  @Patch(':id/response')
  recordResponse(
    @Param('caseId') caseId: string,
    @Param('id') id: string,
    @Body() body: { outcome?: string; responseReceivedAt?: string | null; responseNotes?: string | null },
  ) {
    return this.service.recordResponse(caseId, id, body);
  }

  @Delete(':id')
  remove(@Param('caseId') caseId: string, @Param('id') id: string) {
    return this.service.remove(caseId, id);
  }
}
