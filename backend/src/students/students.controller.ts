import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StudentsService } from './students.service';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get('me')
  getProfile(@Req() req: any) {
    return this.studentsService.getProfile(req.user.userId);
  }

  @Get('me/case')
  getCase(@Req() req: any) {
    return this.studentsService.getCase(req.user.userId);
  }

  @Get('me/documents')
  getDocuments(@Req() req: any) {
    return this.studentsService.getDocuments(req.user.userId);
  }

  // PR-TICKET-CONSOLIDATION — the four /students/me/tickets handlers that lived
  // here are gone.
  //
  // They SHADOWED TicketsController, which is mounted on the same path and was
  // written against VisaSupportTicket, the canonical model. Nest resolved this
  // controller first (position 32 vs 36), so Express served these and the newer
  // controller never received traffic — which is why visa_support_tickets stayed
  // empty while this one accumulated rows.
  //
  // The damage was not only "wrong model". The client-side UI was already built
  // for the VisaSupportTicket shape, so it rendered `tickets.department.null`
  // (only the legacy model allows a null department) and an empty "Reply:" label
  // (the legacy row has no messageCount). And PATCH :id/close — the ONE route
  // that reached TicketsController — looked the id up in the other table and
  // 404'd, so no client could close a ticket.
  //
  // Deleting these makes TicketsController reachable. Nothing else on this
  // controller is affected: its remaining routes are me, me/case, me/documents
  // and me/invoices, none of which overlap.

  @Get('me/invoices')
  getInvoices(@Req() req: any) {
    return this.studentsService.getInvoices(req.user.userId);
  }
}
