import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { R2Module } from '../../common/r2/r2.module';

// PR-DASH-2 — Tickets module.
//
// Mirrors the PR-DASH-1 DashboardModule shape — same Prisma +
// Crypto deps, same controller/service split. Exports
// TicketsService so DashboardModule can import the module and
// reuse the dashboard summary getter without duplicating the
// ownership chain logic.
@Module({
  imports:   [PrismaModule, CryptoModule, R2Module],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports:   [TicketsService],
})
export class TicketsModule {}
