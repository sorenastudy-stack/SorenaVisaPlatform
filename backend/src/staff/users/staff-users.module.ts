import { Module } from '@nestjs/common';
import { StaffUsersController } from './staff-users.controller';
import { StaffUsersService } from './staff-users.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { OwnerApprovalModule } from '../owner-approval/owner-approval.module';
import { CryptoModule } from '../../common/crypto/crypto.module';

// PR-CONSULT-1 — Staff-users module.
//
// Depends on OwnerApprovalModule so the controller can branch on
// caller role: OWNER executes via approval-service executors;
// SUPER_ADMIN goes through requestApproval; ADMIN gets 403.
//
// PR-CONSULT-4: pulls in CryptoModule so the service can encrypt
// the three sensitive profile columns (mobile / address /
// emergencyContact) before persist. The hard-delete flow lives on
// OwnerApprovalService and reuses its AssignmentsService injection.
@Module({
  imports:     [PrismaModule, StaffRolesModule, OwnerApprovalModule, CryptoModule],
  controllers: [StaffUsersController],
  providers:   [StaffUsersService],
})
export class StaffUsersModule {}
