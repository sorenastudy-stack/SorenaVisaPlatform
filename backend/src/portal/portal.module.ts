import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ContractsModule } from '../contracts/contracts.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

// Client portal step 2 — client-only surface.
// PaymentsModule is imported for its exported PaymentsService, used by the
// invoice pay-link route. No cycle: nothing in the payments graph imports
// PortalModule.
// PR-CLIENT-CONTRACT — ContractsModule is imported for its exported
// ContractsService, used by the self-service "Request contract" route. No cycle:
// nothing in the contracts graph (cases/mail/r2) imports PortalModule.
@Module({
  imports:     [PrismaModule, PaymentsModule, PlatformSettingsModule, ContractsModule],
  controllers: [PortalController],
  providers:   [PortalService],
})
export class PortalModule {}
