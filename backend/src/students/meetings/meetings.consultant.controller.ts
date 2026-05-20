import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import { ConsultantMeetingsWriteRateLimitGuard } from './guards/meetings-rate-limit.guards';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto, CancelMeetingDto } from './dto/update-meeting.dto';
import { AttachTranscriptDto } from './dto/attach-transcript.dto';
import { TranscriptNotesDto } from './dto/transcript-notes.dto';
import { ListMeetingsQueryDto } from './dto/list-query.dto';

// PR-DASH-3 — Consultant-side meetings controller.
//
// Mounted at /api/consultant/meetings. Allowed for the full consultant
// /admin tier — SUPER_ADMIN, ADMIN, OPERATIONS, LIA, SUPPORT —
// every non-STUDENT non-AGENT non-SALES role that realistically
// runs client consultations.
//
// All WRITE endpoints additionally gated by a DB-count rate-limit
// guard (50 mutations / hour per staff user). Read endpoints are
// unrestricted — the staff inbox queries should stay snappy.
@Controller('api/consultant/meetings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'LIA', 'SUPPORT')
export class MeetingsConsultantController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@Query() query: ListMeetingsQueryDto) {
    const statuses = query.status?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    return this.meetings.consultantList({
      statuses,
      from:      query.from,
      to:        query.to,
      studentId: query.studentId,
    });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.meetings.consultantDetail(id);
  }

  @Post()
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  create(@Req() req: any, @Body() body: CreateMeetingDto) {
    return this.meetings.consultantCreate(req.user.userId, body);
  }

  @Patch(':id')
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateMeetingDto,
  ) {
    return this.meetings.consultantUpdate(req.user.userId, id, body);
  }

  @Post(':id/cancel')
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CancelMeetingDto,
  ) {
    return this.meetings.consultantCancel(req.user.userId, id, body);
  }

  @Post(':id/complete')
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  complete(@Req() req: any, @Param('id') id: string) {
    return this.meetings.consultantComplete(req.user.userId, id);
  }

  @Post(':id/transcript-metadata')
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  attachTranscript(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AttachTranscriptDto,
  ) {
    return this.meetings.consultantAttachTranscript(req.user.userId, id, body);
  }

  @Delete(':id/transcript-metadata')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  removeTranscript(@Req() req: any, @Param('id') id: string) {
    return this.meetings.consultantRemoveTranscript(req.user.userId, id);
  }

  @Put(':id/transcript-notes')
  @UseGuards(ConsultantMeetingsWriteRateLimitGuard)
  updateNotes(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: TranscriptNotesDto,
  ) {
    return this.meetings.consultantUpdateNotes(req.user.userId, id, body);
  }
}
