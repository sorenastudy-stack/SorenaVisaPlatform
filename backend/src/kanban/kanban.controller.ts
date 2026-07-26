import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { KanbanService } from './kanban.service';
import { CreateStaffTicketDto } from './dto/staff-ticket.dto';

// PR-CO-KANBAN — the Client Officer daily task kanban + the staff/CO raise-ticket
// endpoint. Client Officers (+ admin tier, who see all) reach it; the service
// scopes the board to the caller's own clients.
@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class KanbanController {
  constructor(private readonly kanban: KanbanService) {}

  private actor(req: any) {
    return { userId: req.user?.userId ?? req.user?.id, role: req.user?.role ?? '', name: req.user?.name ?? null };
  }

  // GET /staff/kanban — the caller's clients across the journey (admin sees all).
  @Get('kanban')
  board(@Req() req: any) {
    return this.kanban.getKanban(this.actor(req));
  }

  // POST /staff/tickets — raise a department-routed ticket about a client.
  @Post('tickets')
  raiseTicket(@Body() dto: CreateStaffTicketDto, @Req() req: any) {
    return this.kanban.createStaffTicket(this.actor(req), {
      contactId: dto.contactId, caseId: dto.caseId ?? null, department: dto.department, subject: dto.subject,
    });
  }
}
