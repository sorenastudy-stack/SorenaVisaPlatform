import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CaseMessagesService } from './case-messages.service';
import {
  CreateMessageDto,
  FulfilRequestDto,
  RequestDocumentDto,
} from './dto/case-messages.dto';

// PR-LIA-4 — LIA-side routes for the case-thread.
//
// Mounted under /cases/:caseId/messages/* with the same role gates
// that PR-LIA-1's LegalNotesController uses (LIA / ADMIN / SUPER_ADMIN
// / OWNER). The student-side routes live in a sibling controller in
// this module so both sides share one service.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class CaseMessagesLiaController {
  constructor(private readonly service: CaseMessagesService) {}

  @Get(':caseId/messages')
  list(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.listForCaseAsLia(caseId, this.actor(req));
  }

  @Post(':caseId/messages')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateMessageDto,
    @Req() req: any,
  ) {
    return this.service.createMessageAsLia(caseId, dto, this.actor(req));
  }

  @Post(':caseId/messages/document-request')
  requestDocument(
    @Param('caseId') caseId: string,
    @Body() dto: RequestDocumentDto,
    @Req() req: any,
  ) {
    return this.service.requestDocument(caseId, dto, this.actor(req));
  }

  // Shared mark-read endpoint. Always passes 'LIA' as the viewer
  // because this controller is role-gated to LIA. The student route
  // has its own handler that passes 'CLIENT'.
  @Patch(':caseId/messages/mark-read')
  markRead(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.markRead('LIA', caseId, req.user?.userId, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
