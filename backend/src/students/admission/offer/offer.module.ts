import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';

// PR-ADMISSION-OFFER (step 6) — offer-of-place records. No AI; pure data lifecycle.
@Module({
  imports: [PrismaModule],
  controllers: [OfferController],
  providers: [OfferService],
})
export class OfferModule {}
