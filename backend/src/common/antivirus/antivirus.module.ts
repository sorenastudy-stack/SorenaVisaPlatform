import { Global, Module } from '@nestjs/common';
import { AntivirusService } from './antivirus.service';

// PR-AV slice 1 — one scanner instance, shared.
//
// Global because the remaining upload surfaces (visa, admission, HR, documents)
// will each need it in later slices, and threading a module import through
// every one of them is churn for no benefit. Slice 1 wires only the payment
// receipt; nothing else calls it yet.
@Global()
@Module({
  providers: [AntivirusService],
  exports: [AntivirusService],
})
export class AntivirusModule {}
