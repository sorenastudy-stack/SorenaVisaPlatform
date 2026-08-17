import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderAccessGuard } from './provider-access.guard';
import { ProviderMarketingService } from './provider-marketing.service';

// PR-PROVIDER-PORTAL — marketing files, on the institution's own profile page.
//
// Same boundary as the rest of the portal: the institution comes from the guard,
// never from the request. `:id` names one of the caller's own files and every
// lookup is scoped by providerId as well, so another institution's id matches
// nothing and 404s.
const UPLOAD_LIMIT = { default: { ttl: 60_000, limit: 12 } };

// PR-AV slice 2 — an explicit cap at the multipart boundary, matching the 20 MB
// the service already enforces. Without it multer would buffer the whole body
// into memory before the service ever got to complain about the size, and the
// scanner would be handed bytes no cap had bounded.
const MARKETING_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
};

@Controller('provider/marketing')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderAccessGuard)
@Roles('PROVIDER')
export class ProviderMarketingController {
  constructor(private readonly service: ProviderMarketingService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.list(this.actor(req));
  }

  @Post()
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', MARKETING_UPLOAD))
  upload(@Req() req: any, @UploadedFile() file: any, @Body('label') label?: string) {
    return this.service.upload(file, label, this.actor(req));
  }

  /** A fresh 60-second presigned URL each time — there is no stored link. */
  @Get(':id/download-url')
  downloadUrl(@Req() req: any, @Param('id') id: string) {
    return this.service.downloadUrl(id, this.actor(req));
  }

  /** POST, not DELETE: the row is deactivated and the object is kept. */
  @Post(':id/remove')
  @Throttle(UPLOAD_LIMIT)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(id, this.actor(req));
  }

  private actor(req: any) {
    return {
      providerId: req.providerAccess.providerId,
      providerName: req.providerAccess.providerName,
      userId: req.user?.userId ?? req.user?.id ?? null,
    };
  }
}
