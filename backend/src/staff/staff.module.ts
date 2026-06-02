import { Module } from '@nestjs/common';
import { StaffRolesModule } from './roles/staff-roles.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { OwnerApprovalModule } from './owner-approval/owner-approval.module';
import { StaffUsersModule } from './users/staff-users.module';
import { StaffMeModule } from './me/staff-me.module';
import { StaffCasesModule } from './cases/staff-cases.module';
import { StaffTicketsModule } from './tickets/staff-tickets.module';
import { LiaProfilesModule } from './lia-profiles/lia-profiles.module';

// PR-CONSULT-1 — Staff root module.
//
// Bundles the staff-side modules. Imported once by AppModule;
// AssignmentsModule is re-exported so the DashboardModule can pull
// it in to auto-allocate slots when a VisaCase is created.
//
// PR-CONSULT-2 added the `me` + `cases` sub-modules backing the
// staff dashboard shell and cases list / detail UI.
// PR-SUPPORT-1 added the `tickets` sub-module exposing /staff/tickets/*
// on top of the existing VisaSupportTicket schema.
// PR-DOCUSIGN-1 step 3 added the `lia-profiles` sub-module exposing
// /staff/lia-profile/me/* (LIA self) and (in C2) /staff/lia-profiles/*
// (OWNER/ADMIN verifier).
@Module({
  imports: [
    StaffRolesModule,
    AssignmentsModule,
    OwnerApprovalModule,
    StaffUsersModule,
    StaffMeModule,
    StaffCasesModule,
    StaffTicketsModule,
    LiaProfilesModule,
  ],
  exports: [
    AssignmentsModule,
    StaffRolesModule,
  ],
})
export class StaffModule {}
