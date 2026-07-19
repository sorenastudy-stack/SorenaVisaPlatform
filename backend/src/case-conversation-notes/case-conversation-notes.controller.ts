import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CaseConversationNotesService, NoteActor } from './case-conversation-notes.service';
import {
  CreateConversationNoteDto,
  UpdateConversationNoteDto,
} from './dto/conversation-note.dto';

// PR-LIA-CONVO-NOTES — case-attached LIA conversation notes.
//
// TWO layers of role enforcement, on purpose:
//   1. @Roles('LIA','OWNER','SUPER_ADMIN') + RolesGuard here → the route 403s
//      before the service is even reached for anyone outside the allowlist.
//   2. The service re-checks the same allowlist (assertActorAllowed) so the rule
//      holds even if this controller is ever refactored or the method is called
//      from elsewhere. Read AND write are both gated in both places.
//
// No client route mounts this controller, so the client role never reaches it.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'OWNER', 'SUPER_ADMIN')
export class CaseConversationNotesController {
  constructor(private readonly service: CaseConversationNotesService) {}

  @Get(':caseId/conversation-notes')
  list(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.listForCase(caseId, this.actor(req));
  }

  @Post(':caseId/conversation-notes')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateConversationNoteDto,
    @Req() req: any,
  ) {
    return this.service.createNote(caseId, dto, this.actor(req));
  }

  @Patch(':caseId/conversation-notes/:noteId')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  update(
    @Param('caseId') caseId: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateConversationNoteDto,
    @Req() req: any,
  ) {
    return this.service.updateNote(caseId, noteId, dto, this.actor(req));
  }

  @Delete(':caseId/conversation-notes/:noteId')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  remove(
    @Param('caseId') caseId: string,
    @Param('noteId') noteId: string,
    @Req() req: any,
  ) {
    return this.service.deleteNote(caseId, noteId, this.actor(req));
  }

  /** Build the actor purely from the verified JWT — never from the body. */
  private actor(req: any): NoteActor {
    return {
      id: req.user?.userId ?? req.user?.id,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
      name: req.user?.name ?? null,
    };
  }
}
