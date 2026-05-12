import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailHashService } from './email-hash.service';

@Module({
  imports: [ConfigModule],
  providers: [EmailHashService],
  exports: [EmailHashService],
})
export class EmailHashModule {}
