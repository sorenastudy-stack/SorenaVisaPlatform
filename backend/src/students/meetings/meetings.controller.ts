import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import { ListMeetingsQueryDto } from './dto/list-query.dto';

// PR-DASH-3 — Student-side meetings controller.
//
// Mounted at /api/student/meetings — first /api-prefixed route in
// the project, per the spec. STUDENT role only. Ownership is
// enforced inside MeetingsService.studentList / studentDetail by
// filtering on studentId = req.user.userId — a 404 (not 403) is
// returned for not-owned rows to avoid existence leaks.
@Controller('api/student/meetings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@Req() req: any, @Query() query: ListMeetingsQueryDto) {
    const statuses = query.status?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    return this.meetings.studentList(req.user.userId, {
      statuses,
      from: query.from,
      to:   query.to,
    });
  }

  @Get(':id')
  detail(@Req() req: any, @Param('id') id: string) {
    return this.meetings.studentDetail(req.user.userId, id);
  }
}
