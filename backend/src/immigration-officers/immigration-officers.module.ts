import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { ImmigrationOfficersService } from './immigration-officers.service';
import { ImmigrationOfficersController } from './immigration-officers.controller';
import { CaseOfficerLinkageController } from './case-officer-linkage.controller';
import { OfficerMetricsService } from './officer-metrics.service';
import { OfficerMetricsController } from './officer-metrics.controller';

// PR-LIA-10 — Immigration Officer module.
//
// Hosts both the officer-side controller (/officers) and the case-side
// linkage controller (/cases/:caseId/officer-linkage). They share one
// service so officer aggregates + linkage mutations stay in lock-step.

@Module({
  imports: [PrismaModule, CryptoModule],
  // OfficerMetricsController FIRST — its literal `/metrics` and
  // `/metrics/outliers` routes must be matched before
  // ImmigrationOfficersController's `/:id` param route, otherwise
  // Nest would route `/officers/metrics` to the `:id=metrics` handler.
  controllers: [
    OfficerMetricsController,
    ImmigrationOfficersController,
    CaseOfficerLinkageController,
  ],
  providers: [ImmigrationOfficersService, OfficerMetricsService],
  exports: [ImmigrationOfficersService, OfficerMetricsService],
})
export class ImmigrationOfficersModule {}
