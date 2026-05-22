import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { WixWebhooksController } from './wix-webhooks.controller';
import { WixWebhooksService } from './wix-webhooks.service';
import { WixSecretGuard } from './guards/wix-secret.guard';
import { EventsService } from '../../events/events.service';

// PR-WIX-1 — Wix webhook module.
//
// EventsService is provided locally (it's a leaf service that
// other modules also instantiate directly — same pattern the
// public + admission modules use).
@Module({
  imports:     [ConfigModule, PrismaModule],
  controllers: [WixWebhooksController],
  providers:   [WixWebhooksService, WixSecretGuard, EventsService],
})
export class WixWebhooksModule {}
