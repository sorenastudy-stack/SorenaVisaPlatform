import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

// PR-EMAIL-1 — Unified mail module.
//
// `@Global()` so any service can inject MailService without each
// owning module importing this one. Pattern mirrors PrismaModule's
// approach (any place can use Prisma without re-importing).
// Eventually replaces EmailModule + NotificationsModule once all
// call sites are repointed — for now it coexists with them.
@Global()
@Module({
  providers: [MailService],
  exports:   [MailService],
})
export class MailModule {}
