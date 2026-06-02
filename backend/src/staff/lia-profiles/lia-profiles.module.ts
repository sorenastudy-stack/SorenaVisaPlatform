import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LiaProfilesController } from './lia-profiles.controller';
import { LiaProfilesVerifierController } from './lia-profiles-verifier.controller';
import { LiaProfilesService } from './lia-profiles.service';

// PR-DOCUSIGN-1 step 3 — LIA licence upload + OWNER/ADMIN verification.
// Populates lia_profiles rows so the future assignment-time
// verification gate has something to find.
//
// Two controllers, one service: LiaProfilesController exposes the LIA
// self-service routes at /staff/lia-profile/me (singular); the
// LiaProfilesVerifierController exposes the OWNER/ADMIN/SUPER_ADMIN
// verifier routes at /staff/lia-profiles/* (plural). Distinct paths +
// distinct role guards — no overlap possible.
@Module({
  imports:     [PrismaModule],
  controllers: [LiaProfilesController, LiaProfilesVerifierController],
  providers:   [LiaProfilesService],
})
export class LiaProfilesModule {}
