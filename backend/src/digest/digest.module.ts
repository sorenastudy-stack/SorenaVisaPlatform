import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { DigestService } from './digest.service';

// Phase 8 — weekly client digest module.
//
// Data-gathering layer only. Future PRs will add: cron scheduler,
// email composition (consuming DigestService output), opt-out flags
// on the Contact model, and a "preview last week" staff UI.
//
// Imports CryptoModule for VisaSupportTicket subject decryption — the
// ticket subjects are stored AES-256-GCM encrypted at rest, same
// envelope as the other PII columns.

@Module({
  imports:   [PrismaModule, CryptoModule],
  providers: [DigestService],
  exports:   [DigestService],
})
export class DigestModule {}
