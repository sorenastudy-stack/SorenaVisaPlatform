import { Module } from '@nestjs/common';
import { AcquisitionController } from './acquisition.controller';
import { AcquisitionService } from './acquisition.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [AcquisitionController],
  providers: [AcquisitionService],
})
export class AcquisitionModule {}
