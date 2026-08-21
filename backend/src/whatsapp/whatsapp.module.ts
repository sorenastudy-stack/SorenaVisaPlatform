import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { WhatsappSignatureGuard } from './guards/whatsapp-signature.guard';

@Module({
  imports: [PrismaModule],
  controllers: [WhatsappController],
  // PR-WHATSAPP-SEC-1: WhatsappSignatureGuard provided locally, same
  // convention as DocusignWebhookGuard/DocusealWebhookGuard in
  // contracts.module.ts and WebinarApiKeyGuard in webinars.module.ts.
  providers: [WhatsappService, EventsService, WhatsappSignatureGuard],
  exports: [WhatsappService],
})
export class WhatsappModule {}