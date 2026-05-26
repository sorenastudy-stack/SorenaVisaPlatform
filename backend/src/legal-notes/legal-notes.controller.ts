import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LegalNotesService } from './legal-notes.service';
import {
  CreateLegalNoteDto,
  RecordDecisionDto,
} from './dto/legal-notes.dto';

// PR-LIA-1 — LIA-only endpoints for the case-detail action panel.
//
// `/cases/:caseId/legal-notes`   — list + create free-form notes.
// `/cases/:caseId/decision`      — record a formal decision (APPROVED
//                                   / REJECTED / NEEDS_MORE_INFO /
//                                   WITHDRAWN). Note + decision share
//                                   the same legal_notes table.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class LegalNotesController {
  constructor(private readonly service: LegalNotesService) {}

  @Get(':caseId/legal-notes')
  list(@Param('caseId') caseId: string) {
    return this.service.listForCase(caseId);
  }

  @Post(':caseId/legal-notes')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateLegalNoteDto,
    @Req() req: any,
  ) {
    return this.service.createNote(caseId, dto, {
      id: req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  @Post(':caseId/decision')
  recordDecision(
    @Param('caseId') caseId: string,
    @Body() dto: RecordDecisionDto,
    @Req() req: any,
  ) {
    return this.service.recordDecision(caseId, dto, {
      id: req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }
}
