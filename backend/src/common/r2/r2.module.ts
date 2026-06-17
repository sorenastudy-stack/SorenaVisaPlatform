import { Module } from '@nestjs/common';
import { R2Service } from './r2.service';

// Documents feature foundation — exports R2Service for any feature
// module that needs presigned uploads/downloads against Cloudflare R2.
// Structure mirrors common/crypto/crypto.module.ts. Not yet imported
// by any other module; that happens when the first consumer ships.
@Module({
  providers: [R2Service],
  exports: [R2Service],
})
export class R2Module {}
