import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

// Client portal step 2 — client-only surface.
// PaymentsModule is imported for its exported PaymentsService, used by the
// invoice pay-link route. No cycle: nothing in the payments graph imports
// PortalModule.
@Module({
  imports:     [PrismaModule, PaymentsModule, PlatformSettingsModule],
  controllers: [PortalController],
  providers:   [PortalService],
})
export class PortalModule {}
