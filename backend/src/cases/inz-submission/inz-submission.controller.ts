import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MulterExceptionFilter } from '../../students/admission/multer-exception.filter';
import { createSignedDownloadToken } from '../../common/signed-url.util';
import { InzSubmissionService } from './inz-submission.service';
import {
  EditInzSubmissionDto,
  RevertInzSubmissionDto,
  SubmitToInzDto,
} from './dto/inz-submission.dto';

// PR-LIA-7 — INZ submission endpoints.
//
// Multipart upload mirrors the admission-documents pattern: Multer
// lands the file in ./uploads/pending/ with a random filename, the
// service moves it to ./uploads/inz-receipts/<caseId>/ and stores
// the path on Case. Downloads go through the existing
// /files/signed/:token route — this controller returns a signed URL
// scoped to 5 minutes.
//
// All four routes use req.user?.userId ?? req.user?.id per the
// PR-LIA-d95640d fix (the JWT strategy populates `userId`, not `id`).

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');

const ALLOWED_RECEIPT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
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
    if (ALLOWED_RECEIPT_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Mirror the admission pattern — silently reject so multer
      // doesn't 500. The service re-validates and throws a clean 400.
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class InzSubmissionController {
  constructor(private readonly service: InzSubmissionService) {}

  @Post(':id/inz-submission')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async submit(
    @Param('id') id: string,
    @Body() dto: SubmitToInzDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    if (req.fileTypeRejected) {
      throw new BadRequestException(
        'Unsupported receipt type. Allowed: PDF, JPEG, PNG, HEIC.',
      );
    }
    return this.service.submitToInz(id, dto, file, this.actor(req));
  }

  @Patch(':id/inz-submission')
  edit(
    @Param('id') id: string,
    @Body() dto: EditInzSubmissionDto,
    @Req() req: any,
  ) {
    return this.service.editInzSubmission(id, dto, this.actor(req));
  }

  @Post(':id/inz-submission/revert')
  revert(
    @Param('id') id: string,
    @Body() dto: RevertInzSubmissionDto,
    @Req() req: any,
  ) {
    return this.service.revertInzSubmission(id, dto, this.actor(req));
  }

  // Signed download URL for the receipt. Returns the same shape as
  // PR-LIA-5's /cases/:caseId/documents/:source/:rowId/download-url
  // so the frontend Download component can stay similar.
  @Get(':id/inz-submission/receipt-url')
  async receiptUrl(@Param('id') id: string) {
    const info = await this.service.getReceiptInfo(id);
    const token = createSignedDownloadToken(info);
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  private actor(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... }
      // — `req.user.id` is undefined. Fall back to `id` for safety
      // if a future strategy change adds it.
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
