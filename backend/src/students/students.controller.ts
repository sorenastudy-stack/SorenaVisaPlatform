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

  @Get('me/tickets')
  getTickets(@Req() req: any) {
    return this.studentsService.getTickets(req.user.userId);
  }

  @Get('me/tickets/:id')
  getTicket(@Req() req: any, @Param('id') id: string) {
    return this.studentsService.getTicket(req.user.userId, id);
  }

  @Post('me/tickets')
  createTicket(
    @Req() req: any,
    @Body() body: { subject: string; body: string },
  ) {
    return this.studentsService.createTicket(
      req.user.userId,
      body.subject,
      body.body,
    );
  }

  @Post('me/tickets/:id/messages')
  replyToTicket(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.studentsService.replyToTicket(req.user.userId, id, body.body);
  }

  @Get('me/invoices')
  getInvoices(@Req() req: any) {
    return this.studentsService.getInvoices(req.user.userId);
  }
}
