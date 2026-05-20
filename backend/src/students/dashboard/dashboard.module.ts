import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { TicketsModule } from '../tickets/tickets.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { AssignmentsModule } from '../../staff/assignments/assignments.module';

// PR-DASH-1 — Client-dashboard module.
//
// Lives alongside the existing visa / admission modules under
// /students. Exposes:
//   GET /students/me/dashboard       — full dashboard payload
//   GET /students/me/dashboard/case  — just the VisaCase row
//
// Auto-creates a VisaApplication (if missing) + VisaCase + empty
// AssessmentReport on first load, idempotently, in a single
// transaction. Decrypts the AssessmentReport's summaryNarrative
// before returning.
//
// PR-DASH-2: now imports TicketsModule so the dashboard payload
// can include a small "tickets" summary block (open count + the
// three latest open tickets) without duplicating ownership logic.
@Module({
  // PR-DASH-3: pulls in MeetingsModule for the dashboard's upcoming-
  // meetings summary card.
  // PR-CONSULT-1: pulls in AssignmentsModule so first-load auto-
  // allocates LIA / CONSULTANT / SUPPORT / FINANCE slots after the
  // VisaCase is created.
  imports: [PrismaModule, CryptoModule, TicketsModule, MeetingsModule, AssignmentsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
