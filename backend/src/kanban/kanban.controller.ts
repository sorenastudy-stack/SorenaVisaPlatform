import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { KanbanService } from './kanban.service';

// PR-CO-KANBAN — the Client Officer daily task kanban. Client Officers (+ admin
// tier, who see all) reach it; the service scopes the board to the caller's own
// clients.
//
// The raise-ticket endpoint that lived here was removed by
// PR-TICKET-CONSOLIDATION: it wrote a model no staff surface reads.
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

  // PR-TICKET-CONSOLIDATION — POST /staff/tickets is gone. It wrote the legacy
  // Ticket model, which no staff surface read, so the ticket it created reached
  // nobody. Raising a ticket against a pre-contract lead is not a supported
  // workflow (Owner decision, 15 Aug 2026).
}
