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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProvidersService } from './providers.service';
import { PricingImportService } from './import/pricing-import.service';
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
  constructor(
    private readonly providersService: ProvidersService,
    private readonly pricingImport: PricingImportService,
  ) {}

  @Post()
  @Roles(...PROVIDER_ADMIN)
  create(@Body() dto: CreateProviderDto, @Req() req: any) {
    return this.providersService.createProvider(dto, req.user?.userId ?? null);
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

  // PR-CATALOG-1 — Owner-panel Excel import for ONE institution (multipart upload).
  @Post(':id/import-programmes')
  @Roles(...PROVIDER_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  importProgrammes(
    @Param('id') providerId: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string },
    @Query('dry') dry?: string,
  ) {
    return this.providersService.importProgrammes(providerId, file, dry === 'true');
  }

  // PR-CATALOG-1 — cross-institution pending-programme review queue. Declared
  // before the `:id` route so "programmes" is never captured as a provider id.
  @Get('programmes/pending')
  @Roles(...CATALOG_ADMIN)
  pendingProgrammes() {
    return this.providersService.pendingProgrammes();
  }

  // PR-CATALOG-2 — the unified review queue (pending programmes + web-sync change
  // proposals + new-programme candidates). Declared before `:id` so "review-queue" is
  // never captured as a provider id.
  @Get('review-queue')
  @Roles(...CATALOG_ADMIN)
  reviewQueue() {
    return this.providersService.reviewQueue();
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

  // ── Bulk pricing uploads (PR-EXPLORE Rounds 2+3) — Owner-only ──────────
  // Two sheets per institution, uploaded together: scholarships and tuition,
  // both grouped by country with the country names detected from the sheet.
  // ?dry=true previews (detected countries + flagged rows) WITHOUT writing —
  // the admin screen always previews before committing.
  // The single-row forms below remain for one-off corrections.
  @Post(':id/scholarships/import')
  @Roles(...PROVIDER_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  importScholarships(
    @Param('id') providerId: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; size?: number; mimetype?: string },
    @Query('dry') dry: string | undefined,
    @Req() req: any,
  ) {
    return this.pricingImport.importScholarships(providerId, file, dry === 'true', req.user?.userId ?? null);
  }

  @Post(':id/tuitions/import')
  @Roles(...PROVIDER_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  importTuitions(
    @Param('id') providerId: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; size?: number; mimetype?: string },
    @Query('dry') dry: string | undefined,
    @Req() req: any,
  ) {
    return this.pricingImport.importTuitions(providerId, file, dry === 'true', req.user?.userId ?? null);
  }

  // PR-EXPLORE (Round 2) — Owner-uploaded programme cover image (Explore cards +
  // detail page). Image mime-types only, 2 MB cap, key derived server-side.
  @Post('programmes/:programmeId/cover-image')
  @Roles(...PROVIDER_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  setProgrammeCoverImage(
    @Param('programmeId') programmeId: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string; size?: number },
    @Req() req: any,
  ) {
    return this.providersService.setProgrammeCoverImage(programmeId, file, req.user?.userId ?? null);
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
    return this.providersService.addScholarship(providerId, dto, req.user?.userId ?? null);
  }

  @Patch('scholarships/:scholarshipId')
  @Roles(...PROVIDER_ADMIN)
  updateScholarship(
    @Param('scholarshipId') scholarshipId: string,
    @Body() dto: UpdateScholarshipDto,
    @Req() req: any,
  ) {
    return this.providersService.updateScholarship(scholarshipId, dto, req.user?.userId ?? null);
  }

  @Delete('scholarships/:scholarshipId')
  @Roles(...PROVIDER_ADMIN)
  deleteScholarship(
    @Param('scholarshipId') scholarshipId: string,
    @Req() req: any,
  ) {
    return this.providersService.deleteScholarship(scholarshipId, req.user?.userId ?? null);
  }

  @Patch('programmes/:programmeId/approve')
  @Roles(...CATALOG_ADMIN)
  approveProgramme(
    @Param('programmeId') programmeId: string,
    @Req() req: any,
  ) {
    return this.providersService.approveProgramme(
      programmeId,
      req.user?.userId ?? null,
    );
  }

  @Patch('programmes/:programmeId/reject')
  @Roles(...CATALOG_ADMIN)
  rejectProgramme(
    @Param('programmeId') programmeId: string,
    @Req() req: any,
  ) {
    return this.providersService.rejectProgramme(
      programmeId,
      req.user?.userId ?? null,
    );
  }

  // ── PR-CATALOG-2 — web-sync review actions + manual trigger ────────────────
  // Manual "sync now" for one institution (same sweep the monthly cron runs).
  @Post(':id/sync-now')
  @Roles(...PROVIDER_ADMIN)
  syncNow(@Param('id') providerId: string) {
    return this.providersService.syncNow(providerId);
  }

  @Patch('change-proposals/:id/approve')
  @Roles(...CATALOG_ADMIN)
  approveChange(@Param('id') id: string, @Req() req: any) {
    return this.providersService.approveChange(id, req.user?.userId ?? null);
  }

  @Patch('change-proposals/:id/reject')
  @Roles(...CATALOG_ADMIN)
  rejectChange(@Param('id') id: string, @Req() req: any) {
    return this.providersService.rejectChange(id, req.user?.userId ?? null);
  }

  @Patch('candidates/:id/approve')
  @Roles(...CATALOG_ADMIN)
  approveCandidate(@Param('id') id: string, @Req() req: any) {
    return this.providersService.approveCandidate(id, req.user?.userId ?? null);
  }

  @Patch('candidates/:id/reject')
  @Roles(...CATALOG_ADMIN)
  rejectCandidate(@Param('id') id: string, @Req() req: any) {
    return this.providersService.rejectCandidate(id, req.user?.userId ?? null);
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
