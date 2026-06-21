import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DigestService } from './digest.service';

// Phase 8 — weekly client digest module.
//
// Gather + render + send layers complete. Future PRs will add: the
// cron scheduler, opt-out flags on the Contact model, and a "preview
// last week" staff UI.
//
// Imports:
//   • PrismaModule — gather queries + case→contact resolution
//   • CryptoModule — VisaSupportTicket subject decryption
//   • NotificationsModule — SMTP transport for sendWeeklyDigest

@Module({
  imports:   [PrismaModule, CryptoModule, NotificationsModule],
  providers: [DigestService],
  exports:   [DigestService],
})
export class DigestModule {}
