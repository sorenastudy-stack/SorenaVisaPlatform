import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { OfferService } from './offer.service';

// PR-ADMISSION-OFFER (step 6) — offer-of-place records on the Case File. Same curator-tier guard +
// case scoping as the CV/SOP/Submission surfaces.
@Controller('staff/cases/:caseId/offers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT')
export class OfferController {
  constructor(private readonly service: OfferService) {}

  private actorId(req: any): string | null {
    return req.user?.userId ?? req.user?.id ?? null;
  }

  @Get()
  list(@Param('caseId') caseId: string) {
    return this.service.list(caseId);
  }

  @Post()
  create(@Param('caseId') caseId: string, @Body() body: any, @Req() req: any) {
    return this.service.create(caseId, body, this.actorId(req));
  }

  @Patch(':id')
  update(@Param('caseId') caseId: string, @Param('id') id: string, @Body() body: any) {
    return this.service.update(caseId, id, body);
  }

  @Delete(':id')
  remove(@Param('caseId') caseId: string, @Param('id') id: string) {
    return this.service.remove(caseId, id);
  }
}
