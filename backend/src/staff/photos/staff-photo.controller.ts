import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles, AdminTier } from '../roles/staff-roles.decorator';
import { MulterExceptionFilter } from '../../students/admission/multer-exception.filter';
import { StaffPhotoService } from './staff-photo.service';

// PR-STAFF-PHOTOS — profile-photo endpoints.
//
//   Self (own JWT only):
//     POST   /api/staff/me/photo        (multipart `file`)
//     DELETE /api/staff/me/photo
//   Admin (OWNER/SUPER_ADMIN/ADMIN — @AdminTier), audited in the service:
//     POST   /api/staff/users/:id/photo (multipart `file`)
//     DELETE /api/staff/users/:id/photo
//
// Images only (JPG/PNG/WebP), 5 MB cap — rejected at multer AND re-validated on
// the actual bytes in the service. No userId is ever accepted for the self
// routes; the admin routes are role-gated server-side.

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const ALL_STAFF = [
  'OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT',
  'CLIENT_CONSULTANT', 'SUPPORT', 'FINANCE', 'OPERATIONS',
] as const;

const photoMulter = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else { req.fileTypeRejected = true; cb(null, false); }
  },
};

@Controller('api/staff')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffPhotoController {
  constructor(private readonly photos: StaffPhotoService) {}

  private actor(req: any) {
    return { id: req.user?.userId ?? req.user?.id, name: req.user?.name ?? null, role: req.user?.role ?? null };
  }

  // ── Self ──────────────────────────────────────────────────────────────────
  @Post('me/photo')
  @StaffRoles(...ALL_STAFF)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', photoMulter))
  async uploadOwn(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: any) {
    if (req.fileTypeRejected) throw new UnsupportedMediaTypeException('Only JPG, PNG, or WebP images are accepted.');
    if (!file) throw new BadRequestException('An image file is required.');
    return this.photos.uploadOwnPhoto(req.user.userId, file);
  }

  @Delete('me/photo')
  @StaffRoles(...ALL_STAFF)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async deleteOwn(@Req() req: any) {
    return this.photos.deleteOwnPhoto(req.user.userId);
  }

  // ── Admin (role-gated; audited) ────────────────────────────────────────────
  @Post('users/:id/photo')
  @AdminTier()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', photoMulter))
  async uploadForUser(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: any) {
    if (req.fileTypeRejected) throw new UnsupportedMediaTypeException('Only JPG, PNG, or WebP images are accepted.');
    if (!file) throw new BadRequestException('An image file is required.');
    return this.photos.uploadPhotoForUser(id, file, this.actor(req));
  }

  @Delete('users/:id/photo')
  @AdminTier()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async deleteForUser(@Param('id') id: string, @Req() req: any) {
    return this.photos.deletePhotoForUser(id, this.actor(req));
  }
}
