import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';

// PR-CONSULT-1 — Assignments module.
//
// Exports AssignmentsService so DashboardModule can call
// autoAllocate during VisaCase creation (Pattern: hook into the
// existing ensureDashboardRows transaction).
@Module({
  imports:   [PrismaModule, StaffRolesModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports:   [AssignmentsService],
})
export class AssignmentsModule {}
