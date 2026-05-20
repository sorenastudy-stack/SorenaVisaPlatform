import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { TicketsService } from './tickets.service';
import {
  CreateTicketDto,
  CreateTicketMessageDto,
  ListTicketsQueryDto,
} from './dto/tickets.dto';
import {
  TicketCreationRateLimitGuard,
  TicketMessageRateLimitGuard,
} from './guards/ticket-rate-limit.guards';

// PR-DASH-2 — Client-facing ticket routes.
//
// Mounted under /students/me/tickets/* so the SPA can use one base
// URL for all dashboard data. Controller-level JwtAuthGuard +
// RolesGuard restrict access to authenticated STUDENT users. The
// per-route rate-limit guards run AFTER auth (NestJS guards execute
// in registration order) so an unauthenticated request never even
// queries the rate-limit table.
//
// No staff-side routes here — those land in a future PR; today this
// controller is "client only".
@Controller('students/me/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Req() req: any, @Query() query: ListTicketsQueryDto) {
    // The frontend sends comma-separated values for multi-select
    // filter UIs. We split server-side rather than ?status=a&status=b
    // because the Next.js Link helper can't easily build duplicated
    // params and the URL stays shorter this way.
    const statuses = query.status?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const departments = query.department?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    return this.tickets.listTickets(req.user.userId, { statuses, departments });
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.tickets.getTicket(req.user.userId, id);
  }

  @Post()
  @UseGuards(TicketCreationRateLimitGuard)
  create(@Req() req: any, @Body() body: CreateTicketDto) {
    return this.tickets.createTicket(req.user.userId, body);
  }

  @Post(':id/messages')
  @UseGuards(TicketMessageRateLimitGuard)
  addMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CreateTicketMessageDto,
  ) {
    return this.tickets.addMessage(req.user.userId, id, body);
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Req() req: any, @Param('id') id: string) {
    return this.tickets.closeTicket(req.user.userId, id);
  }
}
