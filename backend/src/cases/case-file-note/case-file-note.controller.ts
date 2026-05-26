import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CaseFileNoteService } from './case-file-note.service';

// PR-LIA-12 — Case File Note endpoints.
//
// Two routes, two distinct role gates:
//   GET  /cases/:caseId/file-note         — LIA/CONSULTANT/ADMIN/SUPER_ADMIN/OWNER
//                                           (service then enforces per-case
//                                            allocation via canAccessCaseFileNote)
//   GET  /cases/:caseId/file-note/export  — OWNER ONLY (defence in depth; the
//                                            service still runs the per-case
//                                            check too)
//
// Per d95640d, actor identity is always req.user?.userId ?? req.user?.id.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CaseFileNoteController {
  constructor(private readonly service: CaseFileNoteService) {}

  @Get(':caseId/file-note')
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN', 'LIA', 'CONSULTANT')
  async getTimeline(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.getTimeline(caseId, this.viewer(req));
  }

  @Get(':caseId/file-note/export')
  @Roles('OWNER')
  async export(
    @Param('caseId') caseId: string,
    @Query('format') format: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const fmt = (format ?? 'md').toLowerCase();
    if (fmt !== 'md' && fmt !== 'txt') {
      throw new BadRequestException('format must be "md" or "txt".');
    }

    const viewer = this.viewer(req);
    const body = fmt === 'md'
      ? await this.service.exportAsMarkdown(caseId, viewer)
      : await this.service.exportAsText(caseId, viewer);

    const today = new Date().toISOString().slice(0, 10);
    const filename = `case-${caseId}-filenote-${today}.${fmt}`;
    const mime = fmt === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  private viewer(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... }.
      userId: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? '',
    };
  }
}
