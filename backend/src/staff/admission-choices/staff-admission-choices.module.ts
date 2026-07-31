import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { StaffAdmissionChoicesService } from './staff-admission-choices.service';
import { StaffAdmissionChoicesController } from './staff-admission-choices.controller';

// PR-ADMISSION-SHARED — Admission Officer programme-choice CRUD + student
// notification (ticket) + case history.
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [StaffAdmissionChoicesController],
  providers: [StaffAdmissionChoicesService],
})
export class StaffAdmissionChoicesModule {}
