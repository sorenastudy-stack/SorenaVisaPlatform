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
} from './dto/case-messages.dto';

// PR-LIA-4 — Student-side routes for the case-thread.
//
// Mounted under /students/me/case-messages/*. The student never
// passes a caseId — the service resolves it from session.userId via
// the same Contact → Lead → Case walk that PR-DASH-2 uses.

@Controller('students/me/case-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class CaseMessagesStudentController {
  constructor(private readonly service: CaseMessagesService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.listForCaseAsClient(req.user.userId, this.actor(req));
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) {
    return this.service
      .unreadCountForStudent(req.user.userId)
      .then((count) => ({ count }));
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateMessageDto) {
    return this.service.createMessageAsClient(req.user.userId, dto, this.actor(req));
  }

  @Post(':messageId/fulfil')
  fulfil(
    @Req() req: any,
    @Param('messageId') messageId: string,
    @Body() dto: FulfilRequestDto,
  ) {
    return this.service.fulfilRequest(req.user.userId, messageId, dto, this.actor(req));
  }

  @Patch('mark-read')
  markRead(@Req() req: any) {
    return this.service.markRead('CLIENT', null, req.user.userId, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
