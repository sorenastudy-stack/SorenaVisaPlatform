import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { DocuSignService } from './docusign.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { CasesModule } from '../cases/cases.module';

@Module({
  // PR-LIA-2: CasesModule exports LiaAssignmentService for the
  // post-sign auto-assignment hook.
  imports: [PrismaModule, MailModule, CasesModule],
  controllers: [ContractsController],
  providers: [ContractsService, DocuSignService],
  exports: [ContractsService, DocuSignService],
})
export class ContractsModule {}
