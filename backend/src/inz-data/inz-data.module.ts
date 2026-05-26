import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { InzDataService } from './inz-data.service';
import { InzDataController } from './inz-data.controller';

// PR-LIA-6 — Consolidated INZ application data viewer for the LIA.
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [InzDataController],
  providers: [InzDataService],
  exports: [InzDataService],
})
export class InzDataModule {}
