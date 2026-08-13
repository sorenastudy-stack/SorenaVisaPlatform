import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

// PR-TAX-INVOICE — the invoice document.
//
// PlatformSettings for the bank details: the invoice prints the account an
// admin edits, not a copy of it.
@Module({
  imports: [PrismaModule, PlatformSettingsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
