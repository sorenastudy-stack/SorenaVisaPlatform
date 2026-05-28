import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { StaffTicketsController } from './staff-tickets.controller';
import { StaffTicketsService } from './staff-tickets.service';
import { StaffTicketMessageRateLimitGuard } from './guards/staff-ticket-message-rate-limit.guard';

// PR-SUPPORT-1 — Staff tickets module.
//
// Operates on the existing VisaSupportTicket / VisaSupportTicketMessage
// tables introduced by PR-DASH-2. No schema changes. The client-side
// TicketsModule under students/tickets/ is untouched and continues to
// serve /students/me/tickets/*.

@Module({
  imports:     [PrismaModule, CryptoModule],
  controllers: [StaffTicketsController],
  providers:   [StaffTicketsService, StaffTicketMessageRateLimitGuard],
  exports:     [StaffTicketsService],
})
export class StaffTicketsModule {}
