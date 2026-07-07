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
  Query,
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
import { AdmissionService } from './admission.service';
import { MulterExceptionFilter } from './multer-exception.filter';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const multerOptions = {
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
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

@Controller('students/me/admission')
@UseGuards(JwtAuthGuard, RolesGuard, EngagementPaidGuard)
@Roles('STUDENT', 'AGENT')
export class AdmissionController {
  constructor(private admissionService: AdmissionService) {}

  // ── Document endpoints (PR 2) ─────────────────────────────────────────────

  @Post('documents')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async uploadDocument(
    @Req() req: any,
    @Body('documentType') documentType: string,
    @Body('educationEntryId') educationEntryId?: string,
  ) {
    if (req.fileTypeRejected) {
      throw new UnsupportedMediaTypeException(
        'Only PDF, JPEG, PNG, and DOCX files are accepted.',
      );
    }
    if (!req.file) {
      throw new UnsupportedMediaTypeException('No file provided.');
    }
    return this.admissionService.uploadDocument(
      req.user.userId,
      req.file,
      documentType,
      educationEntryId,
    );
  }

  @Get('documents')
  listDocuments(
    @Req() req: any,
    @Query('documentType') documentType?: string,
    @Query('educationEntryId') educationEntryId?: string,
  ) {
    return this.admissionService.listDocuments(req.user.userId, documentType, educationEntryId);
  }

  @Get('documents/:id/download')
  getDownloadUrl(@Req() req: any, @Param('id') documentId: string) {
    return this.admissionService.getDownloadUrl(req.user.userId, documentId);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDocument(@Req() req: any, @Param('id') documentId: string) {
    return this.admissionService.deleteDocument(req.user.userId, documentId);
  }

  // ── Application endpoints (PR 3) ──────────────────────────────────────────

  @Get('application')
  getApplication(@Req() req: any) {
    return this.admissionService.getApplication(req.user.userId);
  }

  @Post('application')
  createApplication(@Req() req: any) {
    return this.admissionService.getOrCreateApplication(req.user.userId);
  }

  @Patch('application')
  updateApplication(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.admissionService.updateApplication(req.user.userId, body);
  }

  @Post('application/programme-choices')
  addProgrammeChoice(
    @Req() req: any,
    @Body() body: { programmeId: string; intakeMonth: number; intakeYear: number },
  ) {
    return this.admissionService.addProgrammeChoice(req.user.userId, body);
  }

  // reorder must be declared before /:choiceId to avoid the static segment being
  // matched as a param on PATCH requests
  @Patch('application/programme-choices/reorder')
  reorderProgrammeChoices(
    @Req() req: any,
    @Body() body: { orderedIds: string[] },
  ) {
    return this.admissionService.reorderProgrammeChoices(req.user.userId, body.orderedIds);
  }

  @Delete('application/programme-choices/:choiceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProgrammeChoice(@Req() req: any, @Param('choiceId') choiceId: string) {
    return this.admissionService.deleteProgrammeChoice(req.user.userId, choiceId);
  }

  // ── Education-entry endpoints (PR-EDU1) ──────────────────────────────────

  @Post('application/education-entries')
  addEducationEntry(
    @Req() req: any,
    @Body() body: {
      qualificationLevel: string;
      institutionName: string;
      country: string;
      fieldOfStudy?: string | null;
      startYear?: number | null;
      endYear?: number | null;
      completed?: boolean;
    },
  ) {
    return this.admissionService.addEducationEntry(req.user.userId, body);
  }

  // reorder must be declared before /:entryId to avoid the static segment being
  // matched as a param on PATCH requests
  @Patch('application/education-entries/reorder')
  reorderEducationEntries(
    @Req() req: any,
    @Body() body: { orderedIds: string[] },
  ) {
    return this.admissionService.reorderEducationEntries(req.user.userId, body.orderedIds);
  }

  @Patch('application/education-entries/:entryId')
  updateEducationEntry(
    @Req() req: any,
    @Param('entryId') entryId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.admissionService.updateEducationEntry(req.user.userId, entryId, body);
  }

  @Delete('application/education-entries/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEducationEntry(@Req() req: any, @Param('entryId') entryId: string) {
    return this.admissionService.deleteEducationEntry(req.user.userId, entryId);
  }

  @Post('application/submit')
  submitApplication(@Req() req: any) {
    return this.admissionService.submitApplication(req.user.userId, req.user.role);
  }
}
