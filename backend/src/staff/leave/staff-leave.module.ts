import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffLeaveController } from './staff-leave.controller';
import { StaffLeaveService } from './staff-leave.service';

// PR-BOOKING-ADMIN-B slice 2 — staff self-service leave requests.
@Module({
  imports: [PrismaModule, StaffRolesModule],
  controllers: [StaffLeaveController],
  providers: [StaffLeaveService],
})
export class StaffLeaveModule {}
