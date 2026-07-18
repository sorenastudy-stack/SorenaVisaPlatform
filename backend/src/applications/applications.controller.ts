import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

// Admission applications + attached documents for a case. Was JwtAuthGuard-only
// → any authenticated user could read any case's applications by caseId and
// mutate application status/documents. Gated to the admission-handling staff
// (admin tier + OPERATIONS + the CONSULTANT admission specialist). RolesGuard
// is class-wide, so every route carries an explicit @Roles.
const ADMISSION_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'CONSULTANT'] as const;

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @Roles(...ADMISSION_ROLES)
  create(@Body() dto: CreateApplicationDto) {
    return this.applicationsService.createApplication(dto);
  }

  @Get(':caseId')
  @Roles(...ADMISSION_ROLES)
  findByCase(@Param('caseId') caseId: string) {
    return this.applicationsService.findByCase(caseId);
  }

  @Patch(':id/status')
  @Roles(...ADMISSION_ROLES)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
    @Req() req: any,
  ) {
    return this.applicationsService.updateStatus(id, dto, req.user?.id ?? null);
  }

  @Post(':id/documents')
  @Roles(...ADMISSION_ROLES)
  addDocument(
    @Param('id') applicationId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.applicationsService.addDocument(applicationId, dto);
  }
}
