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
import { memoryStorage } from 'multer';
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
import { UpdateProgrammeDto, SetProgrammeActivationDto } from './dto/update-programme.dto';
import { ProgrammeCurationService } from './programme-curation.service';
import { ProvisionProviderLoginDto } from './dto/provision-provider-login.dto';

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


// PR-AV slice 2 — explicit caps at the multipart boundary. These four staff
// routes had none: multer would buffer an unbounded body into memory before any
// service-level check ran. Sheets match the 5 MB the importers enforce; the
// cover image matches the 2 MB setProgrammeCoverImage enforces. Both sit well
// under clamd's stream limit, so a file can never be too large to scan.
const SHEET_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
};
const COVER_IMAGE_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
};

@Controller('providers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly pricingImport: PricingImportService,
    private readonly programmeCuration: ProgrammeCurationService,
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
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  importProgrammes(
    @Param('id') providerId: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string; size?: number },
    @Query('dry') dry?: string,
    @Req() req?: any,
  ) {
    // actorId threaded through so a scanner refusal names who sent the file.
    return this.providersService.importProgrammes(providerId, file, dry === 'true', req?.user?.userId ?? null);
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
    @Req() req: any,
  ) {
    // actorId threaded through so a status change records WHO made it.
    return this.providersService.updateProvider(providerId, dto, req.user?.userId ?? null);
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
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
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
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
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
  @UseInterceptors(FileInterceptor('file', COVER_IMAGE_UPLOAD))
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

  // PR-PROVIDER-PORTAL slice B — give this institution a login.
  //
  // OWNER only (the service re-checks). Magic-link only: the created User has an
  // unusable password placeholder, so there is no password door to attack.
  // Fails cleanly if a login already exists rather than repointing it.
  @Post(':id/provision-login')
  @Roles('OWNER')
  provisionProviderLogin(
    @Param('id') providerId: string,
    @Body() dto: ProvisionProviderLoginDto,
    @Req() req: any,
  ) {
    return this.providersService.provisionLogin(providerId, dto.email, {
      userId: req.user?.userId ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  // PR-PROVIDER-PORTAL slice A — approve/reject a pending PRICING row.
  // PROVIDER_ADMIN (OWNER/SUPER_ADMIN), matching the tier that already owns the
  // commercial terms — a price is a commercial fact, not catalogue curation.
  @Patch('tuitions/:id/approve')
  @Roles(...PROVIDER_ADMIN)
  approveTuition(@Param('id') id: string, @Req() req: any) {
    return this.providersService.approveTuition(id, req.user?.userId ?? null);
  }

  @Patch('tuitions/:id/reject')
  @Roles(...PROVIDER_ADMIN)
  rejectTuition(@Param('id') id: string, @Req() req: any) {
    return this.providersService.rejectTuition(id, req.user?.userId ?? null);
  }

  @Patch('scholarships/:id/approve')
  @Roles(...PROVIDER_ADMIN)
  approveScholarship(@Param('id') id: string, @Req() req: any) {
    return this.providersService.approveScholarship(id, req.user?.userId ?? null);
  }

  @Patch('scholarships/:id/reject')
  @Roles(...PROVIDER_ADMIN)
  rejectScholarship(@Param('id') id: string, @Req() req: any) {
    return this.providersService.rejectScholarship(id, req.user?.userId ?? null);
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

  // ── PR-CURATION — the Owner's programme review screen ──────────────────────
  // PROVIDER_ADMIN (OWNER/SUPER_ADMIN) throughout, matching the institution edit
  // screen these actions hang off: deciding what students can see is an Owner
  // decision, not general catalogue admin.

  @Get(':id/curation')
  @Roles(...PROVIDER_ADMIN)
  curationList(@Param('id') providerId: string) {
    return this.programmeCuration.listForProvider(providerId);
  }

  @Patch('programmes/:programmeId/curation')
  @Roles(...PROVIDER_ADMIN)
  editProgramme(
    @Param('programmeId') programmeId: string,
    @Body() dto: UpdateProgrammeDto,
    @Req() req: any,
  ) {
    return this.programmeCuration.updateProgramme(programmeId, dto, req.user?.userId ?? null);
  }

  // 409 CONFIRMATION_REQUIRED when students already hold the programme; the
  // client re-sends with confirm: true.
  @Patch('programmes/:programmeId/activation')
  @Roles(...PROVIDER_ADMIN)
  setProgrammeActivation(
    @Param('programmeId') programmeId: string,
    @Body() dto: SetProgrammeActivationDto,
    @Req() req: any,
  ) {
    return this.programmeCuration.setActivation(programmeId, dto, req.user?.userId ?? null);
  }

  @Post(':id/curation/activation-bulk')
  @Roles(...PROVIDER_ADMIN)
  setProgrammeActivationBulk(
    @Body() body: { programmeIds: string[]; active: boolean; confirm?: boolean },
    @Req() req: any,
  ) {
    return this.programmeCuration.setActivationBulk(
      body.programmeIds ?? [], body.active, body.confirm === true, req.user?.userId ?? null,
    );
  }
}
