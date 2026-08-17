import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProviderPortalController } from './provider-portal.controller';
import { ProviderPortalService } from './provider-portal.service';
import { ProviderAccessGuard } from './provider-access.guard';

// PR-PROVIDER-PORTAL slice B — the institution-facing surface, deliberately its
// own module so nothing staff-side can accidentally mount a route inside the
// ownership boundary.
@Module({
  imports: [PrismaModule],
  controllers: [ProviderPortalController],
  providers: [ProviderPortalService, ProviderAccessGuard],
})
export class ProviderPortalModule {}
