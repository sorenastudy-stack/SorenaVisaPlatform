import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderAccessGuard } from './provider-access.guard';
import { NationalityGroupService } from './nationality-group.service';
import {
  CreateGroupScholarshipDto, CreateGroupTuitionDto, UpsertNationalityGroupDto,
} from './dto/nationality-group.dto';

// PR-PROVIDER-PORTAL slice E — nationality groups and grouped rates.
//
// Same shape as slice D: ids name RESOURCES, the tenant comes from the guard, and
// the service scopes every lookup by `{ id, providerId }` so another
// institution's id matches nothing.
//
// There IS a delete here, unlike programmes — a group is a label an institution
// invented, with no student decision hanging off it. It is refused while any rate
// still points at the group; see the service for why blocking beats nulling.
const WRITE_LIMIT = { default: { ttl: 60_000, limit: 40 } };

@Controller('provider/nationality-groups')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderAccessGuard)
@Roles('PROVIDER')
export class NationalityGroupController {
  constructor(private readonly service: NationalityGroupService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.list(this.actor(req));
  }

  /** Every rate the institution has, grouped or single — the rate screen's data. */
  @Get('rates')
  rates(@Req() req: any) {
    return this.service.listRates(this.actor(req));
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  create(@Req() req: any, @Body() dto: UpsertNationalityGroupDto) {
    return this.service.create(dto, this.actor(req));
  }

  @Put(':id')
  @Throttle(WRITE_LIMIT)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpsertNationalityGroupDto) {
    return this.service.update(id, dto, this.actor(req));
  }

  @Delete(':id')
  @Throttle(WRITE_LIMIT)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(id, this.actor(req));
  }

  // ── Rates against a group. PENDING like every other rate. ───────────────────
  @Post('rates/tuition')
  @Throttle(WRITE_LIMIT)
  createTuition(@Req() req: any, @Body() dto: CreateGroupTuitionDto) {
    return this.service.createGroupTuition(dto, this.actor(req));
  }

  @Post('rates/scholarship')
  @Throttle(WRITE_LIMIT)
  createScholarship(@Req() req: any, @Body() dto: CreateGroupScholarshipDto) {
    return this.service.createGroupScholarship(dto, this.actor(req));
  }

  // ── Clearing one rate, straight from the list that shows it ────────────────
  //
  // Two explicit routes rather than one with a `:kind` segment: the kind decides
  // which table is written, and a path parameter that selects a table is a
  // parameter worth not having.
  //
  // POST, not DELETE: nothing is deleted. The row is deactivated, exactly as
  // blanking the amount on the form does.
  @Post('rates/tuition/:id/clear')
  @Throttle(WRITE_LIMIT)
  clearTuition(@Req() req: any, @Param('id') id: string) {
    return this.service.clearRate('tuition', id, this.actor(req));
  }

  @Post('rates/scholarship/:id/clear')
  @Throttle(WRITE_LIMIT)
  clearScholarship(@Req() req: any, @Param('id') id: string) {
    return this.service.clearRate('scholarship', id, this.actor(req));
  }

  private actor(req: any) {
    return {
      providerId: req.providerAccess.providerId,
      providerName: req.providerAccess.providerName,
      userId: req.user?.userId ?? req.user?.id ?? null,
    };
  }
}
