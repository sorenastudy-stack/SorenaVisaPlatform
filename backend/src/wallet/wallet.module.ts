import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';

// PR-WALLET slice 1 — wallet + store-credit ledger + policy-acceptance capture.
// Exports the services so the booking flow can record acceptance (slice 1) and
// later slices can post tiered-refund credits / booking-spend debits.
@Module({
  imports: [PrismaModule],
  controllers: [WalletController],
  providers: [WalletService, PolicyAcceptanceService],
  exports: [WalletService, PolicyAcceptanceService],
})
export class WalletModule {}
