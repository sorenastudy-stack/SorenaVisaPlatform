import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MulterExceptionFilter } from '../../students/admission/multer-exception.filter';
import { LiaProfilesService } from './lia-profiles.service';
import { UpdateLicenceNumberDto } from './dto/lia-profile.dto';

// PR-DOCUSIGN-1 step 3 — LIA self-service routes.
//
// E1  GET  /staff/lia-profile/me
// E2  PUT  /staff/lia-profile/me/licence-number
// E3  POST /staff/lia-profile/me/licence-file        (multipart)
// E4  GET  /staff/lia-profile/me/licence-file/download-url
//
// Cross-tenant guard: userId always comes from the JWT (req.user.userId).
// No userId in path/query/body on these routes — there is nothing to
// attack to read or write another LIA's profile.

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');
// PR-DOCUSIGN-1 (scope widening): IAA licence accepts a PDF or a
// register-page screenshot (PNG / JPG). 10 MB size cap unchanged.
// Must mirror the service-side allowlist — service re-validates
// after multer's fileFilter passes.
const ALLOWED_LICENCE_MIMES = ['application/pdf', 'image/png', 'image/jpeg'];

const licenceFileMulterOptions = {
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
    if (ALLOWED_LICENCE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Mirror PR-LIA-7 / admission — silently reject so multer doesn't
      // 500; the controller re-validates and throws a clean 400 with
      // the allowed-types message.
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

@Controller('staff/lia-profile/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA')
export class LiaProfilesController {
  constructor(private readonly service: LiaProfilesService) {}

  @Get()
  getOwn(@Req() req: any) {
    return this.service.getOwnProfile(this.userId(req));
  }

  // Tighter than the global 60/min baseline: credential writes are
  // low-frequency by nature — 20/min/IP is generous for a human yet caps
  // abuse of the file-upload + audit-write path.
  @Put('licence-number')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  updateLicenceNumber(@Body() dto: UpdateLicenceNumberDto, @Req() req: any) {
    return this.service.updateOwnLicenceNumber(this.userId(req), dto, this.actor(req));
  }

  @Post('licence-file')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', licenceFileMulterOptions))
  async uploadLicenceFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    if (req.fileTypeRejected) {
      throw new BadRequestException(
        'Unsupported licence file type. Allowed: PDF, PNG, or JPEG.',
      );
    }
    return this.service.uploadOwnLicenceFile(this.userId(req), file, this.actor(req));
  }

  @Get('licence-file/download-url')
  getOwnDownloadUrl(@Req() req: any) {
    return this.service.getOwnLicenceDownloadUrl(this.userId(req));
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... } —
  // `req.user.id` is undefined. Fall back to `id` so a future strategy
  // change adding it doesn't silently break the cross-tenant guard.
  private userId(req: any): string {
    return req.user?.userId ?? req.user?.id;
  }

  private actor(req: any) {
    return {
      id: this.userId(req),
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
