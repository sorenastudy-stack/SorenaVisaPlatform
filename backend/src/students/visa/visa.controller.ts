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
}
