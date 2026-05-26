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
import { VisaService } from './visa.service';
import {
  DeclineVisaDto,
  EditVisaDto,
  IssueVisaDto,
  RevertVisaDto,
} from './dto/visa.dto';

// PR-LIA-8 — Visa lifecycle endpoints.
//
// Five routes:
//   POST   /cases/:id/visa/issue          (multipart — APPROVED + file)
//   POST   /cases/:id/visa/decline        (JSON — DECLINED + reason)
//   PATCH  /cases/:id/visa                (JSON — text-only edit)
//   POST   /cases/:id/visa/revert         (JSON — destructive un-issue)
//   GET    /cases/:id/visa/document-url   (signed 5-min URL)
//
// Role gate: LIA / ADMIN / SUPER_ADMIN / OWNER (class-level @Roles).
// Actor id: req.user?.userId ?? req.user?.id (PR-LIA-d95640d).

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');

const ALLOWED_VISA_MIMES = [
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
    if (ALLOWED_VISA_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class VisaController {
  constructor(private readonly service: VisaService) {}

  @Post(':id/visa/issue')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async issue(
    @Param('id') id: string,
    @Body() dto: IssueVisaDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    if (req.fileTypeRejected) {
      throw new BadRequestException(
        'Unsupported visa document type. Allowed: PDF, JPEG, PNG, HEIC.',
      );
    }
    return this.service.issueApprovedVisa(id, dto, file, this.actor(req));
  }

  @Post(':id/visa/decline')
  decline(
    @Param('id') id: string,
    @Body() dto: DeclineVisaDto,
    @Req() req: any,
  ) {
    return this.service.recordDeclinedVisa(id, dto, this.actor(req));
  }

  @Patch(':id/visa')
  edit(
    @Param('id') id: string,
    @Body() dto: EditVisaDto,
    @Req() req: any,
  ) {
    return this.service.editVisaRecord(id, dto, this.actor(req));
  }

  @Post(':id/visa/revert')
  revert(
    @Param('id') id: string,
    @Body() dto: RevertVisaDto,
    @Req() req: any,
  ) {
    return this.service.revertVisaRecord(id, dto, this.actor(req));
  }

  @Get(':id/visa/document-url')
  async documentUrl(@Param('id') id: string, @Req() req: any) {
    const info = await this.service.getVisaDocumentInfo(id, this.actor(req));
    const token = createSignedDownloadToken(info);
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  private actor(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... }.
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
