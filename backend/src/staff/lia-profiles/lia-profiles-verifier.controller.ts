import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { LiaProfilesService } from './lia-profiles.service';
import { RejectLicenceDto } from './dto/lia-profile.dto';

// PR-DOCUSIGN-1 step 3 — OWNER / ADMIN / SUPER_ADMIN verifier routes.
//
// E5  GET  /staff/lia-profiles/pending-verification
// E6  GET  /staff/lia-profiles/:userId/licence-file/download-url   (audit-logged)
// E7  POST /staff/lia-profiles/:userId/verify                       (self-guard at service)
// E8  POST /staff/lia-profiles/:userId/reject                       (self-guard at service)
//
// Intentionally a SEPARATE controller from LiaProfilesController so
// the role gates never overlap: the LIA self-service routes are
// /staff/lia-profile/me (singular, @Roles('LIA')); these verifier
// routes are /staff/lia-profiles/* (plural, @Roles('OWNER','ADMIN',
// 'SUPER_ADMIN')). No path can resolve to both controllers.
//
// Static `pending-verification` route is declared BEFORE the
// `:userId/...` routes so Express matches the literal path first.

@Controller('staff/lia-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
export class LiaProfilesVerifierController {
  constructor(private readonly service: LiaProfilesService) {}

  @Get('pending-verification')
  listPending() {
    return this.service.listPendingVerification();
  }

  @Get(':userId/licence-file/download-url')
  downloadLicence(@Param('userId') userId: string, @Req() req: any) {
    return this.service.getLicenceDownloadUrlForVerifier(userId, this.actor(req));
  }

  @Post(':userId/verify')
  verify(@Param('userId') userId: string, @Req() req: any) {
    return this.service.verifyProfile(userId, this.actor(req));
  }

  @Post(':userId/reject')
  reject(
    @Param('userId') userId: string,
    @Body() dto: RejectLicenceDto,
    @Req() req: any,
  ) {
    return this.service.rejectProfile(userId, dto, this.actor(req));
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... } —
      // `req.user.id` is undefined. Fall back to `id` for forward-
      // compat if a future strategy change adds it.
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
