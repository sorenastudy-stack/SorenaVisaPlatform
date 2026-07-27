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
import { ProvidersService } from './providers.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { CreateProgrammeDto } from './dto/create-programme.dto';
import { ProgrammeListQueryDto } from './dto/programme-filter.dto';
import { ProviderListQueryDto } from './dto/provider-list-filter.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateScholarshipDto } from './dto/create-scholarship.dto';
import { UpdateScholarshipDto } from './dto/update-scholarship.dto';

// Provider/programme catalog — institutional reference data (not user PII), but
// the reads were allow-all and several writes (faculties/programmes/agreement
// terms/requirements) were ungated, so any authenticated user could mutate the
// catalog and commercial agreement terms. Reads → admission-handling staff.
// PROVIDER_ADMIN = the Owner-only tier for the commercial provider terms
// (create/edit provider, agreement, commissions, scholarships) — PR-UNIVERSITIES
// tightened these from ADMIN to OWNER/SUPER_ADMIN. CATALOG_ADMIN (still incl.
// ADMIN) remains for programme/faculty curation + approve/reject.
const CATALOG_READ = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'CONSULTANT'] as const;
const CATALOG_ADMIN = ['OWNER', 'SUPER_ADMIN', 'ADMIN'] as const;
const PROVIDER_ADMIN = ['OWNER', 'SUPER_ADMIN'] as const;

@Controller('providers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Post()
  @Roles(...PROVIDER_ADMIN)
  create(@Body() dto: CreateProviderDto, @Req() req: any) {
    return this.providersService.createProvider(dto, req.user?.id ?? null);
  }

  @Get()
  @Roles(...CATALOG_READ)
  findAll(@Query() query: ProviderListQueryDto) {
    return this.providersService.findAll(query);
  }

  @Get(':id/faculties')
  @Roles(...CATALOG_READ)
  findFaculties(@Param('id') providerId: string) {
    return this.providersService.findFaculties(providerId);
  }

  @Post(':id/faculties')
  @Roles(...CATALOG_ADMIN)
  addFaculty(@Param('id') providerId: string, @Body() dto: CreateFacultyDto) {
    return this.providersService.addFaculty(providerId, dto);
  }

  @Get(':id/programmes')
  @Roles(...CATALOG_READ)
  findProgrammes(
    @Param('id') providerId: string,
    @Query() query: ProgrammeListQueryDto,
  ) {
    return this.providersService.findProgrammes(providerId, query);
  }

  @Post(':id/programmes')
  @Roles(...CATALOG_ADMIN)
  addProgramme(
    @Param('id') providerId: string,
    @Body() dto: CreateProgrammeDto,
  ) {
    return this.providersService.addProgramme(providerId, dto);
  }

  @Get(':id')
  @Roles(...CATALOG_READ)
  findOne(@Param('id') providerId: string) {
    return this.providersService.findOne(providerId);
  }

  @Patch(':id')
  @Roles(...PROVIDER_ADMIN)
  update(
    @Param('id') providerId: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providersService.updateProvider(providerId, dto);
  }

  @Patch(':id/agreement')
  @Roles(...PROVIDER_ADMIN)
  updateAgreement(
    @Param('id') providerId: string,
    @Body() dto: UpdateAgreementDto,
  ) {
    return this.providersService.updateAgreement(providerId, dto);
  }

  // ── Scholarships (PR-UNIVERSITIES) — Owner-only writes ─────────────────
  @Get(':id/scholarships')
  @Roles(...CATALOG_READ)
  findScholarships(@Param('id') providerId: string) {
    return this.providersService.findScholarships(providerId);
  }

  @Post(':id/scholarships')
  @Roles(...PROVIDER_ADMIN)
  addScholarship(
    @Param('id') providerId: string,
    @Body() dto: CreateScholarshipDto,
    @Req() req: any,
  ) {
    return this.providersService.addScholarship(providerId, dto, req.user?.id ?? null);
  }

  @Patch('scholarships/:scholarshipId')
  @Roles(...PROVIDER_ADMIN)
  updateScholarship(
    @Param('scholarshipId') scholarshipId: string,
    @Body() dto: UpdateScholarshipDto,
    @Req() req: any,
  ) {
    return this.providersService.updateScholarship(scholarshipId, dto, req.user?.id ?? null);
  }

  @Delete('scholarships/:scholarshipId')
  @Roles(...PROVIDER_ADMIN)
  deleteScholarship(
    @Param('scholarshipId') scholarshipId: string,
    @Req() req: any,
  ) {
    return this.providersService.deleteScholarship(scholarshipId, req.user?.id ?? null);
  }

  @Patch('programmes/:programmeId/approve')
  @Roles('ADMIN', 'SUPER_ADMIN')
  approveProgramme(
    @Param('programmeId') programmeId: string,
    @Req() req: any,
  ) {
    return this.providersService.approveProgramme(
      programmeId,
      req.user?.id ?? null,
    );
  }

  @Patch('programmes/:programmeId/reject')
  @Roles('ADMIN', 'SUPER_ADMIN')
  rejectProgramme(
    @Param('programmeId') programmeId: string,
    @Req() req: any,
  ) {
    return this.providersService.rejectProgramme(
      programmeId,
      req.user?.id ?? null,
    );
  }

  @Post('programmes/:programmeId/requirements')
  @Roles(...CATALOG_ADMIN)
  addRequirement(
    @Param('programmeId') programmeId: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.providersService.addRequirement(programmeId, dto);
  }

  @Get('programmes/:programmeId/requirements')
  @Roles(...CATALOG_READ)
  findRequirement(@Param('programmeId') programmeId: string) {
    return this.providersService.findRequirement(programmeId);
  }
}
