import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';

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
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
