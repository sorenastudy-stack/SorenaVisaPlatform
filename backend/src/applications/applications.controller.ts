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
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto) {
    return this.applicationsService.createApplication(dto);
  }

  @Get(':caseId')
  findByCase(@Param('caseId') caseId: string) {
    return this.applicationsService.findByCase(caseId);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
    @Req() req: any,
  ) {
    return this.applicationsService.updateStatus(id, dto, req.user?.id ?? null);
  }

  @Post(':id/documents')
  addDocument(
    @Param('id') applicationId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.applicationsService.addDocument(applicationId, dto);
  }
}
