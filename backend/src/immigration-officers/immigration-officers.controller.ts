import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImmigrationOfficersService } from './immigration-officers.service';
import {
  AddObservationDto,
  CreateOfficerDto,
  ListOfficersQueryDto,
  UpdateOfficerDto,
} from './dto/immigration-officers.dto';

// PR-LIA-10 — Immigration Officer module endpoints.
//
// Mounted under /officers (top-level). The case-side linkage endpoints
// live in CaseOfficerLinkageController (separate file, mounted under
// /cases/:caseId/officer-linkage).
//
// Role gate: most routes accept LIA / ADMIN / SUPER_ADMIN / OWNER.
// DELETE /officers/:id is stricter — OWNER / SUPER_ADMIN only — to
// protect institutional knowledge from accidental loss.
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('officers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImmigrationOfficersController {
  constructor(private readonly service: ImmigrationOfficersService) {}

  @Get()
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  list(@Query() query: ListOfficersQueryDto) {
    return this.service.listOfficers(query);
  }

  @Get(':id')
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  detail(@Param('id') id: string) {
    return this.service.getOfficer(id);
  }

  @Post()
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  create(@Body() dto: CreateOfficerDto, @Req() req: any) {
    return this.service.createOfficer(dto, this.actor(req));
  }

  @Patch(':id')
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateOfficerDto, @Req() req: any) {
    return this.service.updateOfficer(id, dto, this.actor(req));
  }

  @Delete(':id')
  @Roles('OWNER', 'SUPER_ADMIN')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.service.deleteOfficer(id, this.actor(req));
  }

  @Post(':id/observations')
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  addObservation(
    @Param('id') id: string,
    @Body() dto: AddObservationDto,
    @Req() req: any,
  ) {
    return this.service.addObservation(id, dto, this.actor(req));
  }

  @Delete(':officerId/observations/:observationId')
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  deleteObservation(
    @Param('officerId') officerId: string,
    @Param('observationId') observationId: string,
    @Req() req: any,
  ) {
    // The service enforces "only the author can delete" — role gate is
    // the broader "you have to be portal-eligible at all" check.
    return this.service.deleteOwnObservation(officerId, observationId, this.actor(req));
  }

  private actor(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... }.
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
