import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { LegalNotesController } from './legal-notes.controller';
import { LegalNotesService } from './legal-notes.service';

// PR-LIA-1 — Legal-notes + decisions module. LIA / ADMIN / SUPER_ADMIN
// only; the controller carries the @Roles guard.
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [LegalNotesController],
  providers: [LegalNotesService],
  exports: [LegalNotesService],
})
export class LegalNotesModule {}
