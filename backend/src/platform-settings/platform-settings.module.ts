import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsController } from './platform-settings.controller';

// PR-SCORECARD-4 — Platform-settings module.
//
// Exports the service so other modules (Scorecard for booking-URL
// reads, WixIntegration for webhook-secret reads) can inject it.

@Module({
  imports: [PrismaModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
