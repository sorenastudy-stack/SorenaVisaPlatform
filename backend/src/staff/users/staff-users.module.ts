import { Module } from '@nestjs/common';
import { StaffUsersController } from './staff-users.controller';
import { StaffUsersService } from './staff-users.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { OwnerApprovalModule } from '../owner-approval/owner-approval.module';

// PR-CONSULT-1 — Staff-users module.
//
// Depends on OwnerApprovalModule so the controller can branch on
// caller role: OWNER executes via approval-service executors;
// SUPER_ADMIN goes through requestApproval; ADMIN gets 403.
@Module({
  imports:   [PrismaModule, StaffRolesModule, OwnerApprovalModule],
  controllers: [StaffUsersController],
  providers: [StaffUsersService],
})
export class StaffUsersModule {}
