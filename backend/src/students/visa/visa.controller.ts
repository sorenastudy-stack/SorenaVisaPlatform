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
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { VisaService } from './visa.service';
import { MilitaryHistoryDto } from './dto/military-history.dto';
import { TravelHistoryDto } from './dto/travel-history.dto';
import { ImmigrationAssistanceDto } from './dto/immigration-assistance.dto';

// All endpoints are gated by JwtAuthGuard + RolesGuard. STUDENT and AGENT are
// the only roles allowed — same scope as AdmissionController. Every method
// resolves the admission_applications row through the caller's userId before
// touching visa_applications, so a student can only ever read/write their
// own row.
@Controller('students/me/visa')
@UseGuards(JwtAuthGuard, RolesGuard)
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
}
