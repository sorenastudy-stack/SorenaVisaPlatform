import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffAdmissionEmploymentService } from './staff-admission-employment.service';
import { StaffAdmissionEmploymentController } from './staff-admission-employment.controller';

// PR-ADMISSION-CVDATA (step 2a) — staff view/edit of client employment history.
@Module({
  imports: [PrismaModule],
  controllers: [StaffAdmissionEmploymentController],
  providers: [StaffAdmissionEmploymentService],
})
export class StaffAdmissionEmploymentModule {}
