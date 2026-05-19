import {
  Body,
  Controller,
  Get,
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
}
