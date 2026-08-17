import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderAccessGuard } from './provider-access.guard';
import { ProviderProgrammeService } from './provider-programme.service';
import {
  CreateOwnProgrammeDto, SetOwnProgrammeActiveDto, UpdateOwnProgrammeDto,
} from './dto/provider-programme.dto';

// PR-PROVIDER-PORTAL slice D — an institution's own programmes.
//
// THIS IS THE FIRST CONTROLLER IN THE PORTAL THAT TAKES AN ID, and it is worth
// being precise about why that does not weaken slices B and C.
//
// There, an id could only ever have meant "which institution", so accepting one
// would have meant accepting a claim about identity — and the answer was to
// accept none. Here the id means "which of MY programmes", which the caller has
// to be able to say. The claim it makes is about a resource, and it is checked:
// every read and write in the service is scoped by the id AND the guard-resolved
// providerId together. Another institution's id matches no row, so it 404s —
// indistinguishable from an id that does not exist, which is the correct answer
// to "does that institution have this programme?" as well.
//
// So the invariant is unchanged in substance: THE TENANT IS NEVER TAKEN FROM THE
// REQUEST. Only the resource is.
//
// There is NO DELETE ROUTE, and there cannot be one: RecommendationItem and
// AdmissionProgrammeChoice both hold a required FK with no cascade, so the
// database refuses. "Remove it" means deactivate.
@Controller('provider/programmes')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderAccessGuard)
@Roles('PROVIDER')
export class ProviderProgrammeController {
  constructor(private readonly service: ProviderProgrammeService) {}

  /** Their own catalogue. Never anyone else's — the service scopes by provider. */
  @Get()
  list(@Req() req: any) {
    return this.service.list(this.actor(req));
  }

  @Get(':id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getOne(id, this.actor(req));
  }

  /** Lands PENDING and inactive, exactly as an imported row does. */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  create(@Req() req: any, @Body() dto: CreateOwnProgrammeDto) {
    return this.service.create(dto, this.actor(req));
  }

  /** An edit that changes content costs the approval; an edit that changes nothing does not. */
  @Patch(':id')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateOwnProgrammeDto) {
    return this.service.update(id, dto, this.actor(req));
  }

  /**
   * The switch, and only the switch.
   *
   * Separate from PATCH :id on purpose. If activation lived in the edit DTO it
   * would travel with the content diff, and turning a programme off for a
   * semester would send it back to the review queue — which is precisely the
   * coupling slice D exists to undo.
   */
  @Patch(':id/active')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  setActive(@Req() req: any, @Param('id') id: string, @Body() dto: SetOwnProgrammeActiveDto) {
    return this.service.setActive(id, dto.active, this.actor(req));
  }

  /** The caller, entirely from the guard. */
  private actor(req: any) {
    return {
      providerId: req.providerAccess.providerId,
      providerName: req.providerAccess.providerName,
      userId: req.user?.userId ?? req.user?.id ?? null,
    };
  }
}
