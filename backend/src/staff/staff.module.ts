import { Module } from '@nestjs/common';
import { StaffRolesModule } from './roles/staff-roles.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { OwnerApprovalModule } from './owner-approval/owner-approval.module';
import { StaffUsersModule } from './users/staff-users.module';

// PR-CONSULT-1 — Staff root module.
//
// Bundles the four staff-side modules. Imported once by AppModule;
// AssignmentsModule is re-exported so the DashboardModule can pull
// it in to auto-allocate slots when a VisaCase is created.
@Module({
  imports: [
    StaffRolesModule,
    AssignmentsModule,
    OwnerApprovalModule,
    StaffUsersModule,
  ],
  exports: [
    AssignmentsModule,
    StaffRolesModule,
  ],
})
export class StaffModule {}
