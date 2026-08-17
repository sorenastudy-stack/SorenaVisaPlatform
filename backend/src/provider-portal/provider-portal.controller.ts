import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderAccessGuard } from './provider-access.guard';
import { ProviderPortalService } from './provider-portal.service';
import { UpdateOwnProviderDto } from './dto/update-own-provider.dto';

// PR-PROVIDER-PORTAL slice B — the institution's own surface.
//
// A SEPARATE CONTROLLER, NOT AN EXTENSION OF ProvidersController. That one has
// no ownership check on `:id` anywhere — `req.user` appears in it seventeen
// times and every one is attribution, never authorisation — so adding PROVIDER
// to its role lists would let any institution read any other's pricing. The
// boundary is not a role, it is the fact that these routes cannot name a target.
//
// NO ROUTE HERE ACCEPTS AN ID. Not in the path, not in a query, not in a body.
// Every route reads `req.providerAccess.providerId`, which the guard resolved
// from the JWT. Combined with the global `forbidNonWhitelisted` pipe, a request
// that tries to nominate an institution is REJECTED (400) rather than silently
// ignored — there is no code path in which a caller-supplied id is read at all,
// so there is no conflict to resolve.
@Controller('provider')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderAccessGuard)
@Roles('PROVIDER')
export class ProviderPortalController {
  constructor(private readonly service: ProviderPortalService) {}

  /** The caller's own institution. */
  @Get('me')
  me(@Req() req: any) {
    return this.service.getOwn(req.providerAccess.providerId);
  }

  /**
   * Update the caller's own institution — descriptive fields only.
   *
   * Rate-limited on top of the global per-identity limit: an authenticated
   * write loop is cheap to start and this is the only write an institution has.
   */
  @Patch('me')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  updateMe(@Req() req: any, @Body() dto: UpdateOwnProviderDto) {
    return this.service.updateOwn(
      req.providerAccess.providerId,
      dto,
      { userId: req.user?.userId ?? req.user?.id ?? null, name: req.user?.name ?? null },
    );
  }
}
