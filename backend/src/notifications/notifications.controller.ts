import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

// PR-HANDOFF — a person's own notifications.
//
// No @Roles: everything here is scoped to the caller's own id in the query, so
// the only thing a role gate could add is deciding who is allowed to have
// notifications at all — which is everyone with an account.
@Controller('api/staff/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  private me(req: any): string {
    return req.user?.userId ?? req.user?.id;
  }

  @Get()
  list(@Req() req: any) {
    return this.service.list(this.me(req));
  }

  /** Just the number, for the badge — polled far more often than the list. */
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    return { unread: await this.service.unreadCount(this.me(req)) };
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @Req() req: any) {
    return this.service.markRead(id, this.me(req));
  }

  @Post('read-all')
  markAllRead(@Req() req: any) {
    return this.service.markAllRead(this.me(req));
  }
}
