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
import { DocumentsService } from './documents.service';
import { RequestUploadDto } from './dto/request-upload.dto';

// Documents step 3 — R2-backed case attachments.
//
// Mounted under @Controller('cases') so the routes live alongside
// the operational /cases controller. JwtAuthGuard at class level;
// the per-case access gate (DocumentsService.assertAccess) handles
// the role + slot + client check.

@Controller('cases')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Post(':caseId/documents/request-upload')
  requestUpload(
    @Param('caseId') caseId: string,
    @Body() dto: RequestUploadDto,
    @Req() req: any,
  ) {
    return this.service.requestUpload(caseId, dto, this.actor(req));
  }

  @Post(':caseId/documents/:documentId/confirm')
  confirmUpload(
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    return this.service.confirmUpload(caseId, documentId, this.actor(req));
  }

  @Get(':caseId/documents')
  list(@Param('caseId') caseId: string, @Req() req: any) {
    return this.service.listDocuments(caseId, this.actor(req));
  }

  @Get(':caseId/documents/:documentId/download-url')
  downloadUrl(
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    return this.service.getDownloadUrl(caseId, documentId, this.actor(req));
  }

  @Delete(':caseId/documents/:documentId')
  delete(
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    return this.service.deleteDocument(caseId, documentId, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
