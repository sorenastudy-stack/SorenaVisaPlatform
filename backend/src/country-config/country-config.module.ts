import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CountryConfigService } from './country-config.service';
import { CountryConfigController } from './country-config.controller';

// PR-OWNER-1 (slice a) — Country Intelligence & Monetisation Config module.
//
// Exports the service so slice (b) (matcher wiring) can inject it to read a
// country's execution config when ranking recommendations.

@Module({
  imports: [PrismaModule],
  controllers: [CountryConfigController],
  providers: [CountryConfigService],
  exports: [CountryConfigService],
})
export class CountryConfigModule {}
