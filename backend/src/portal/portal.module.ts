import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

// Client portal step 2 — client-only surface.
// Only one route today: GET /portal/me/case.
@Module({
  imports:     [PrismaModule],
  controllers: [PortalController],
  providers:   [PortalService],
})
export class PortalModule {}
