import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CaseConversationNotesController } from './case-conversation-notes.controller';
import { CaseConversationNotesService } from './case-conversation-notes.service';

// PR-LIA-CONVO-NOTES — LIA conversation notes module. Read + write are limited
// to LIA / OWNER / SUPER_ADMIN; the controller carries @Roles and the service
// re-enforces the same allowlist.
@Module({
  imports: [PrismaModule],
  controllers: [CaseConversationNotesController],
  providers: [CaseConversationNotesService],
  exports: [CaseConversationNotesService],
})
export class CaseConversationNotesModule {}
