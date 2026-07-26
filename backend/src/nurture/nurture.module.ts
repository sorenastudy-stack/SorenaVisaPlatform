import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { NurtureService } from './nurture.service';
import { NurtureCronService } from './nurture-cron.service';
import { NurtureController } from './nurture.controller';
import { NurturePublicController } from './nurture-public.controller';

// PR-NURTURE — post-FREE_15 nurture sequence + monthly newsletter.
// ScheduleModule.forRoot() is registered app-wide (visa-expiry.module), so the
// @Cron in NurtureCronService is discovered without re-registering it here.
@Module({
  imports: [PrismaModule, MailModule],
  controllers: [NurtureController, NurturePublicController],
  providers: [NurtureService, NurtureCronService],
})
export class NurtureModule {}
