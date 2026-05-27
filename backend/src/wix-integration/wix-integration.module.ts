import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { WixPaymentsService } from './wix-payments.service';
import { WixWebhookController } from './wix-webhook.controller';
import { WixPaymentsController } from './wix-payments.controller';

// PR-SCORECARD-4 — Wix payment integration.
//
// Hosts two controllers:
//   * WixWebhookController     — public POST /webhooks/wix/payment
//                                (shared-secret authenticated)
//   * WixPaymentsController    — staff GET /staff/wix-payments[/:id]
//
// Both share WixPaymentsService. The webhook controller looks up the
// shared secret via PlatformSettingsService.getInternal() at request
// time so rotation takes effect immediately without restart.

@Module({
  imports: [PrismaModule, PlatformSettingsModule],
  controllers: [WixWebhookController, WixPaymentsController],
  providers: [WixPaymentsService],
  exports: [WixPaymentsService],
})
export class WixIntegrationModule {}
