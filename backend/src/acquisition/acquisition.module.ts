import { Module } from '@nestjs/common';
import { AcquisitionController } from './acquisition.controller';
import { AcquisitionService } from './acquisition.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [AcquisitionController],
  providers: [AcquisitionService],
})
export class AcquisitionModule {}
