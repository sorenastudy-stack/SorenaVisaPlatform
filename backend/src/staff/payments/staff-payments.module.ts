import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffPaymentsController } from './staff-payments.controller';
import { StaffFinanceController } from './staff-finance.controller';
import { StaffPaymentsService } from './staff-payments.service';

// Piece #3 — accountant "confirm payments" module. FINANCE/OWNER-gated
// endpoints to list processing invoices, view the uploaded receipt, confirm
// (SENT→PAID), or reject (clear receipt for re-upload). StaffRolesModule
// provides the StaffRolesGuard.
//
// Finance portal (this piece) adds StaffFinanceController — read-only
// dashboard + finalised ledger, same service, same FINANCE/OWNER gate.
@Module({
  imports: [PrismaModule, StaffRolesModule],
  controllers: [StaffPaymentsController, StaffFinanceController],
  providers: [StaffPaymentsService],
})
export class StaffPaymentsModule {}
