import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DiaryService } from './diary.service';

// PR-DIARY — the caller's daily agenda (today + missed) across their nurture call
// tasks + consultation meetings. Read-only. Same roles that own those items
// (assignee roles + admin tier); the service scopes to the caller ("mine").
@Controller('staff/diary')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class DiaryController {
  constructor(private readonly diary: DiaryService) {}

  @Get()
  myDiary(@Req() req: any) {
    return this.diary.getMyDiary({ userId: req.user?.userId ?? req.user?.id, role: req.user?.role ?? '' });
  }
}
