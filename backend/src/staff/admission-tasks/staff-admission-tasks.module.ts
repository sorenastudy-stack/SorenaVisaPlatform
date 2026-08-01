import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffAdmissionTasksService } from './staff-admission-tasks.service';
import { StaffAdmissionTasksController } from './staff-admission-tasks.controller';

// PR-INTAKE-1 (Slice 3) — Admission Officer task list.
@Module({
  imports: [PrismaModule],
  controllers: [StaffAdmissionTasksController],
  providers: [StaffAdmissionTasksService],
})
export class StaffAdmissionTasksModule {}
