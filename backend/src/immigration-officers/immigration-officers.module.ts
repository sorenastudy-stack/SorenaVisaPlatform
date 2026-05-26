import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { ImmigrationOfficersService } from './immigration-officers.service';
import { ImmigrationOfficersController } from './immigration-officers.controller';
import { CaseOfficerLinkageController } from './case-officer-linkage.controller';

// PR-LIA-10 — Immigration Officer module.
//
// Hosts both the officer-side controller (/officers) and the case-side
// linkage controller (/cases/:caseId/officer-linkage). They share one
// service so officer aggregates + linkage mutations stay in lock-step.

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [ImmigrationOfficersController, CaseOfficerLinkageController],
  providers: [ImmigrationOfficersService],
  exports: [ImmigrationOfficersService],
})
export class ImmigrationOfficersModule {}
