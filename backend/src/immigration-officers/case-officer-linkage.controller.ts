import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImmigrationOfficersService } from './immigration-officers.service';
import { LinkOfficerDto } from './dto/immigration-officers.dto';

// PR-LIA-10 — Case-side linkage endpoints. Mounted under /cases so
// the routes co-locate with the existing case namespace, but the
// controller + service live in the officers module for cohesion.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class CaseOfficerLinkageController {
  constructor(private readonly service: ImmigrationOfficersService) {}

  @Get(':caseId/officer-linkage')
  get(@Param('caseId') caseId: string) {
    return this.service.getLinkageForCase(caseId);
  }

  @Post(':caseId/officer-linkage')
  link(
    @Param('caseId') caseId: string,
    @Body() dto: LinkOfficerDto,
    @Req() req: any,
  ) {
    return this.service.linkCaseToOfficer(caseId, dto, this.actor(req));
  }

  @Delete(':caseId/officer-linkage')
  unlink(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.unlinkCaseFromOfficer(caseId, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
