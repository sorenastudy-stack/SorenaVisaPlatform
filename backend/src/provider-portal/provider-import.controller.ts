import { Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderAccessGuard } from './provider-access.guard';
import { ProviderImportService } from './provider-import.service';

// PR-PROVIDER-PORTAL slice C — the institution's own upload surface.
//
// Same rule as slice B and for the same reason: NO ROUTE HERE ACCEPTS AN ID.
// Not in the path, not in a query, not in a body. The institution is whoever
// the session says it is, and `req.providerAccess.providerId` is the only way
// this file can learn one.
//
// The dry run is a SEPARATE ROUTE rather than `?dry=true`. The staff endpoints
// take the flag as a query parameter, which is fine there; here it would mean
// this controller reads the query string, and "it only ever reads `dry`" is a
// property someone has to keep true forever. A route that cannot read a query
// string at all needs nobody to remember anything — and /check vs /apply says
// what it does more plainly than a flag does. The BEHAVIOUR is the staff
// behaviour, unchanged: /check runs the importer's own dry run.
//
// Rate limit: 6 uploads a minute. Every one of these parses a spreadsheet, so
// they cost real work per request, and the limiter is keyed by token subject
// (IdentityThrottlerGuard), which means per institution rather than per address.
// PR-AV slice 2 — an explicit cap at the multipart boundary on all six routes,
// matching the 5 MB assertProviderFile already enforces. The service check runs
// after multer has buffered the whole body; this one stops it at the door.
const SHEET_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
};

const UPLOAD_LIMIT = { default: { ttl: 60_000, limit: 6 } };

@Controller('provider/imports')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderAccessGuard)
@Roles('PROVIDER')
export class ProviderImportController {
  constructor(private readonly imports: ProviderImportService) {}

  // ── Programmes ─────────────────────────────────────────────────────────────
  @Post('programmes/check')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  checkProgrammes(@Req() req: any, @UploadedFile() file: any) {
    return this.imports.run('programmes', this.actor(req), file, true);
  }

  @Post('programmes/apply')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  applyProgrammes(@Req() req: any, @UploadedFile() file: any) {
    return this.imports.run('programmes', this.actor(req), file, false);
  }

  // ── Tuition ────────────────────────────────────────────────────────────────
  @Post('tuition/check')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  checkTuition(@Req() req: any, @UploadedFile() file: any) {
    return this.imports.run('tuition', this.actor(req), file, true);
  }

  @Post('tuition/apply')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  applyTuition(@Req() req: any, @UploadedFile() file: any) {
    return this.imports.run('tuition', this.actor(req), file, false);
  }

  // ── Scholarships ───────────────────────────────────────────────────────────
  @Post('scholarships/check')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  checkScholarships(@Req() req: any, @UploadedFile() file: any) {
    return this.imports.run('scholarships', this.actor(req), file, true);
  }

  @Post('scholarships/apply')
  @Throttle(UPLOAD_LIMIT)
  @UseInterceptors(FileInterceptor('file', SHEET_UPLOAD))
  applyScholarships(@Req() req: any, @UploadedFile() file: any) {
    return this.imports.run('scholarships', this.actor(req), file, false);
  }

  /** The caller, entirely from the guard. Nothing here reads the request body. */
  private actor(req: any) {
    return {
      providerId: req.providerAccess.providerId,
      providerName: req.providerAccess.providerName,
      userId: req.user?.userId ?? req.user?.id ?? null,
    };
  }
}
