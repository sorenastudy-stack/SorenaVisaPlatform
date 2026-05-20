import { Module } from '@nestjs/common';
import { OwnerApprovalController } from './owner-approval.controller';
import { OwnerApprovalService } from './owner-approval.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { AssignmentsModule } from '../assignments/assignments.module';

// PR-CONSULT-1 — Owner-approval module.
//
// Exports the service so the staff-users module can call
// `requestApproval()` / `createStaffUserDirect()` / etc. — the
// staff CRUD endpoints branch on role (OWNER executes inline,
// SUPER_ADMIN enqueues, ADMIN 403).
@Module({
  imports:   [PrismaModule, CryptoModule, StaffRolesModule, AssignmentsModule],
  controllers: [OwnerApprovalController],
  providers: [OwnerApprovalService],
  exports:   [OwnerApprovalService],
})
export class OwnerApprovalModule {}
