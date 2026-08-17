import { Global, Module } from '@nestjs/common';
import { AntivirusService } from './antivirus.service';
import { UploadScanService } from './upload-scan.service';

// PR-AV slice 1 — one scanner instance, shared.
// PR-AV slice 2 — plus UploadScanService, the single scan-or-reject gate every
// upload route goes through. Global because 22 upload points across 12 modules
// need it, and threading a module import through every one of them is churn for
// no benefit. PrismaModule is global too, so the audit write needs no wiring.
@Global()
@Module({
  providers: [AntivirusService, UploadScanService],
  exports: [AntivirusService, UploadScanService],
})
export class AntivirusModule {}
