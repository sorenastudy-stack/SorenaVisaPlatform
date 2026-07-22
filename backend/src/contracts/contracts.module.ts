import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { DocuSignService } from './docusign.service';
import { DocusignWebhookGuard } from './docusign-webhook.guard';
import { DocusealService } from './docuseal.service';
import { DocusealWebhookGuard } from './docuseal-webhook.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { CasesModule } from '../cases/cases.module';
import { R2Module } from '../common/r2/r2.module';

@Module({
  // PR-LIA-2: CasesModule exports LiaAssignmentService for the
  // post-sign auto-assignment hook.
  imports: [PrismaModule, MailModule, CasesModule, R2Module],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    DocuSignService,
    DocusignWebhookGuard,
    // PR-DOCUSEAL — active provider + its webhook guard.
    DocusealService,
    DocusealWebhookGuard,
  ],
  exports: [ContractsService, DocuSignService, DocusealService],
})
export class ContractsModule {}
