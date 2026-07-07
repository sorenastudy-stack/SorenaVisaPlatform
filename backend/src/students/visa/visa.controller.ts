import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnsupportedMediaTypeException,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { EngagementPaidGuard } from '../../common/guards/engagement-paid.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MulterExceptionFilter } from '../admission/multer-exception.filter';
import { VisaService } from './visa.service';
import { MilitaryHistoryDto } from './dto/military-history.dto';
import { TravelHistoryDto } from './dto/travel-history.dto';
import { ImmigrationAssistanceDto } from './dto/immigration-assistance.dto';
import {
  SupportingDocumentsDto,
  VisaSupportingDocumentTypeDto,
} from './dto/supporting-documents.dto';
import {
  SupportingDocuments2Dto,
  OtherEvidenceEntryDto,
} from './dto/supporting-documents-2.dto';

// PR-FILES-1 — multer config mirrors the admission upload pattern
// (admission.controller.ts:39-59). Disk storage lands the file in
// PENDING_DIR with a random filename; the boot-time pending sweep
// in main.ts removes any pending file older than 1 h. The 10 MB
// size cap + PDF / JPEG / PNG allowlist match the DTO-level limits
// declared in supporting-documents.dto.ts and matches the page-1
// guidance copy in the UI. Security-layer hooks (see also the
// service file): layer 7 (size limit + type allowlist + random
// filename), enforced at the multer boundary so a rejected file
// never even reaches the service.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');

const VISA_ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

const visaMulterOptions = {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      fs.mkdirSync(PENDING_DIR, { recursive: true });
      cb(null, PENDING_DIR);
    },
    filename: (_req: any, file: any, cb: any) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (VISA_ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

// All endpoints are gated by JwtAuthGuard + RolesGuard. STUDENT and AGENT are
// the only roles allowed — same scope as AdmissionController. Every method
// resolves the admission_applications row through the caller's userId before
// touching visa_applications, so a student can only ever read/write their
// own row.
@Controller('students/me/visa')
@UseGuards(JwtAuthGuard, RolesGuard, EngagementPaidGuard)
@Roles('STUDENT', 'AGENT')
export class VisaController {
  constructor(private visaService: VisaService) {}

  @Get('application')
  getApplication(@Req() req: any) {
    return this.visaService.getApplication(req.user.userId);
  }

  @Post('application')
  createApplication(@Req() req: any) {
    return this.visaService.getOrCreateApplication(req.user.userId);
  }

  @Patch('application')
  updateApplication(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.updateApplication(req.user.userId, body);
  }

  // ── Other citizenships CRUD (PR-VISA4 fix) ────────────────────────
  // Same shape as AdmissionController's education-entries routes; the
  // service enforces ownership via the userId → contact → visa
  // application chain so a student can only touch their own rows.

  @Post('citizenships')
  addCitizenship(
    @Req() req: any,
    @Body() body: { country: string; holdsPassport: boolean },
  ) {
    return this.visaService.addOtherCitizenship(req.user.userId, body);
  }

  @Patch('citizenships/:id')
  updateCitizenship(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { country?: string; holdsPassport?: boolean },
  ) {
    return this.visaService.updateOtherCitizenship(req.user.userId, id, body);
  }

  @Delete('citizenships/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCitizenship(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteOtherCitizenship(req.user.userId, id);
  }

  // ── TB-risk countries CRUD (PR-VISA5) ────────────────────────────
  // Same shape as the citizenships routes. The service enforces
  // ownership through the userId → contact → visa chain.

  @Post('tb-countries')
  addTbCountry(
    @Req() req: any,
    @Body() body: { country?: string; totalDurationDays?: number },
  ) {
    return this.visaService.addTbRiskCountry(req.user.userId, body);
  }

  @Patch('tb-countries/:id')
  updateTbCountry(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { country?: string; totalDurationDays?: number },
  ) {
    return this.visaService.updateTbRiskCountry(req.user.userId, id, body);
  }

  @Delete('tb-countries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTbCountry(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteTbRiskCountry(req.user.userId, id);
  }

  // ── Education supplements (PR-VISA6) ─────────────────────────────
  // Single upsert route keyed by the admission education-entry id. No
  // POST/DELETE — the supplement's lifecycle is bound to the admission
  // entry (cascade FK), so creation happens implicitly on the first
  // PATCH and deletion happens automatically with the parent entry.
  @Patch('education-supplements/:educationEntryId')
  upsertEducationSupplement(
    @Req() req: any,
    @Param('educationEntryId') educationEntryId: string,
    @Body() body: {
      startMonth?: number | null;
      endMonth?: number | null;
      institutionState?: string | null;
      institutionTown?: string | null;
      qualificationAwarded?: boolean | null;
    },
  ) {
    return this.visaService.upsertEducationSupplement(
      req.user.userId,
      educationEntryId,
      body,
    );
  }

  // ── Employment entries CRUD (PR-VISA7) ───────────────────────────
  @Post('employment-entries')
  addEmploymentEntry(
    @Req() req: any,
    @Body() body: { entryKind: string; [k: string]: unknown },
  ) {
    return this.visaService.addEmploymentEntry(req.user.userId, body);
  }

  @Patch('employment-entries/:id')
  updateEmploymentEntry(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.visaService.updateEmploymentEntry(req.user.userId, id, body);
  }

  @Delete('employment-entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEmploymentEntry(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteEmploymentEntry(req.user.userId, id);
  }

  // ── Unemployment entries CRUD (PR-VISA7) ─────────────────────────
  @Post('unemployment-entries')
  addUnemploymentEntry(
    @Req() req: any,
    @Body() body: Record<string, unknown>,
  ) {
    return this.visaService.addUnemploymentEntry(req.user.userId, body);
  }

  @Patch('unemployment-entries/:id')
  updateUnemploymentEntry(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.visaService.updateUnemploymentEntry(req.user.userId, id, body);
  }

  @Delete('unemployment-entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUnemploymentEntry(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteUnemploymentEntry(req.user.userId, id);
  }

  // ── Step 8 — Relationships (PR-VISA8) ──────────────────────────
  // Partner is singleton — single upsert route, no POST/DELETE.
  // Everything else is the same POST/PATCH/DELETE shape as the other
  // repeating tables.

  @Patch('partner')
  upsertPartner(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.upsertPartner(req.user.userId, body);
  }

  @Post('former-partners')
  addFormerPartner(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.addFormerPartner(req.user.userId, body);
  }
  @Patch('former-partners/:id')
  updateFormerPartner(@Req() req: any, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.visaService.updateFormerPartner(req.user.userId, id, body);
  }
  @Delete('former-partners/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFormerPartner(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteFormerPartner(req.user.userId, id);
  }

  @Post('children')
  addChild(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.addChild(req.user.userId, body);
  }
  @Patch('children/:id')
  updateChild(@Req() req: any, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.visaService.updateChild(req.user.userId, id, body);
  }
  @Delete('children/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteChild(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteChild(req.user.userId, id);
  }

  @Post('parents')
  addParent(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.addParent(req.user.userId, body);
  }
  @Patch('parents/:id')
  updateParent(@Req() req: any, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.visaService.updateParent(req.user.userId, id, body);
  }
  @Delete('parents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteParent(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteParent(req.user.userId, id);
  }

  @Post('siblings')
  addSibling(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.addSibling(req.user.userId, body);
  }
  @Patch('siblings/:id')
  updateSibling(@Req() req: any, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.visaService.updateSibling(req.user.userId, id, body);
  }
  @Delete('siblings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSibling(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteSibling(req.user.userId, id);
  }

  @Post('nz-contacts')
  addNzContact(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.visaService.addNzContact(req.user.userId, body);
  }
  @Patch('nz-contacts/:id')
  updateNzContact(@Req() req: any, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.visaService.updateNzContact(req.user.userId, id, body);
  }
  @Delete('nz-contacts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteNzContact(@Req() req: any, @Param('id') id: string) {
    return this.visaService.deleteNzContact(req.user.userId, id);
  }

  // ── Step 10 — Military service (PR-VISA10) ───────────────────────
  // Single GET + single PATCH (replace-on-save). The controller-level
  // JwtAuthGuard + RolesGuard + @Roles('STUDENT','AGENT') decorators
  // gate every method on this controller; the service-level resolver
  // ensures the caller can only read/write their own visa application.

  @Get('military-history')
  getMilitaryHistory(@Req() req: any) {
    return this.visaService.getMilitaryHistory(req.user.userId);
  }

  @Patch('military-history')
  saveMilitaryHistory(
    @Req() req: any,
    @Body() body: MilitaryHistoryDto,
  ) {
    return this.visaService.saveMilitaryHistory(req.user.userId, body);
  }

  // ── Step 11 — Travel history (PR-VISA11) ─────────────────────────
  // Single GET + single PATCH (replace-on-save), mirroring Step 10.
  // Controller-level JwtAuthGuard + RolesGuard + @Roles('STUDENT',
  // 'AGENT') gate every method; the service-level resolver ensures
  // the caller can only touch their own visa application.

  @Get('travel-history')
  getTravelHistory(@Req() req: any) {
    return this.visaService.getTravelHistory(req.user.userId);
  }

  @Patch('travel-history')
  saveTravelHistory(
    @Req() req: any,
    @Body() body: TravelHistoryDto,
  ) {
    return this.visaService.saveTravelHistory(req.user.userId, body);
  }

  // ── Step 12 — Immigration assistance (PR-VISA12) ─────────────────
  // Single-instance section (no child table). Same controller-level
  // JwtAuthGuard + RolesGuard + @Roles('STUDENT','AGENT') gate as
  // every other route on this controller.

  @Get('immigration-assistance')
  getImmigrationAssistance(@Req() req: any) {
    return this.visaService.getImmigrationAssistance(req.user.userId);
  }

  @Patch('immigration-assistance')
  saveImmigrationAssistance(
    @Req() req: any,
    @Body() body: ImmigrationAssistanceDto,
  ) {
    return this.visaService.saveImmigrationAssistance(req.user.userId, body);
  }

  // ── Step 13 — Supporting documents page 1 ──────────────────────────
  // PR-FILES-2 — parent-row flags PATCH + list GET. Per-file routes
  // live in the PR-FILES-2 block further down (uploads add a child
  // file; deletes target a child file id; the metadata-only PUT is
  // gone — uploads always carry bytes now).

  @Get('supporting-documents')
  getSupportingDocuments(@Req() req: any) {
    return this.visaService.getSupportingDocuments(req.user.userId);
  }

  @Patch('supporting-documents')
  saveSupportingDocuments(
    @Req() req: any,
    @Body() body: SupportingDocumentsDto,
  ) {
    return this.visaService.saveSupportingDocuments(req.user.userId, body);
  }

  // PR-FILES-2 — "clear the whole requirement for this type". Drops
  // the parent row and cascades every child file (DB CASCADE + best-
  // effort fs.unlink). The legacy ".../metadata/" segment stays so
  // the frontend can keep calling this URL through PR-FILES-2 step 3.
  @Delete('supporting-documents/metadata/:documentType')
  deleteSupportingDocumentRequirement(
    @Req() req: any,
    @Param('documentType') documentType: VisaSupportingDocumentTypeDto,
  ) {
    return this.visaService.deleteSupportingDocumentRequirement(
      req.user.userId,
      documentType,
    );
  }

  // ── Step 14 — Supporting documents page 2 (PR-VISA14) ────────────
  // FINAL Visa Section step. File storage still deferred — the four
  // routes below only handle metadata. The 17 new document types
  // (OFFER_OF_PLACE, BANK_STATEMENTS, …) reuse PR-13's metadata
  // endpoint above; what's new here is the 28-field parent PATCH +
  // the "Other evidence" repeating block.

  @Get('supporting-documents-2')
  getSupportingDocuments2(@Req() req: any) {
    return this.visaService.getSupportingDocuments2(req.user.userId);
  }

  @Patch('supporting-documents-2')
  saveSupportingDocuments2(
    @Req() req: any,
    @Body() body: SupportingDocuments2Dto,
  ) {
    return this.visaService.saveSupportingDocuments2(req.user.userId, body);
  }

  @Put('supporting-documents-2/other-evidence')
  upsertOtherEvidenceEntry(
    @Req() req: any,
    @Body() body: OtherEvidenceEntryDto,
  ) {
    return this.visaService.upsertOtherEvidenceEntry(req.user.userId, body);
  }

  @Delete('supporting-documents-2/other-evidence/:entryId')
  deleteOtherEvidenceEntry(
    @Req() req: any,
    @Param('entryId') entryId: string,
  ) {
    return this.visaService.deleteOtherEvidenceEntry(
      req.user.userId,
      entryId,
    );
  }

  // ── PR-FILES-2: per-file routes ────────────────────────────────────
  //
  // Uploads ADD a child file (never replace). Per-file delete + per-
  // file download both take a child-file id and 404 on mismatched
  // ownership (the service walks file → parent → visaApplicationId
  // via the JWT-derived visa row).
  //
  // Security layers:
  //   - layer 2 (auth + role + owner-scoped): every route on this
  //     controller is gated by JwtAuthGuard + RolesGuard +
  //     @Roles('STUDENT','AGENT'); the service resolves the visa
  //     application through the JWT's userId so a caller can only
  //     touch their own files.
  //   - layer 7 (input): multer config above enforces the 10 MB cap +
  //     PDF/JPEG/PNG allowlist + random filename. Throttle caps the
  //     upload rate to match the admission pattern (10 / 60 s).
  //   - layer 7 (output): downloads return a JWT-signed URL with a
  //     5-min TTL via the existing /files/signed/:token controller.
  //   - layer 6 (audit): VISA_DOC_UPLOADED / VISA_DOC_DELETED /
  //     VISA_DOC_DOWNLOADED rows written on every successful call.

  // ── Step 13 supporting documents — file ops ────────────────────────

  @Post('supporting-documents/:documentType/file')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', visaMulterOptions))
  async uploadSupportingDocumentFile(
    @Req() req: any,
    @Param('documentType') documentType: VisaSupportingDocumentTypeDto,
  ) {
    if (req.fileTypeRejected) {
      throw new UnsupportedMediaTypeException(
        'Only PDF, JPEG, and PNG files are accepted.',
      );
    }
    if (!req.file) {
      throw new UnsupportedMediaTypeException('No file provided.');
    }
    return this.visaService.uploadSupportingDocumentFile(
      req.user.userId,
      documentType,
      req.file,
    );
  }

  @Delete('supporting-documents/files/:fileId')
  deleteSupportingDocumentFile(
    @Req() req: any,
    @Param('fileId') fileId: string,
  ) {
    return this.visaService.deleteSupportingDocumentFile(req.user.userId, fileId);
  }

  @Get('supporting-documents/files/:fileId/download')
  getSupportingDocumentFileDownloadUrl(
    @Req() req: any,
    @Param('fileId') fileId: string,
  ) {
    return this.visaService.getSupportingDocumentFileDownloadUrl(
      req.user.userId,
      fileId,
    );
  }

  // ── Step 14 other-evidence — file ops ──────────────────────────────
  // The entry must already exist (created via PUT .../other-evidence)
  // before files can be attached to it. Per-file delete + download
  // take a child-file id; entry-level delete (DELETE .../other-evidence/:entryId)
  // still wipes the entry and cascades its files.

  @Post('supporting-documents-2/other-evidence/:entryId/file')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', visaMulterOptions))
  async uploadOtherEvidenceFile(
    @Req() req: any,
    @Param('entryId') entryId: string,
  ) {
    if (req.fileTypeRejected) {
      throw new UnsupportedMediaTypeException(
        'Only PDF, JPEG, and PNG files are accepted.',
      );
    }
    if (!req.file) {
      throw new UnsupportedMediaTypeException('No file provided.');
    }
    return this.visaService.uploadOtherEvidenceFile(
      req.user.userId,
      entryId,
      req.file,
    );
  }

  @Delete('supporting-documents-2/other-evidence/files/:fileId')
  deleteOtherEvidenceFile(
    @Req() req: any,
    @Param('fileId') fileId: string,
  ) {
    return this.visaService.deleteOtherEvidenceFile(req.user.userId, fileId);
  }

  @Get('supporting-documents-2/other-evidence/files/:fileId/download')
  getOtherEvidenceFileDownloadUrl(
    @Req() req: any,
    @Param('fileId') fileId: string,
  ) {
    return this.visaService.getOtherEvidenceFileDownloadUrl(
      req.user.userId,
      fileId,
    );
  }
}
