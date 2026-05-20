import { Module } from '@nestjs/common';
import { StaffRolesGuard } from './staff-roles.guard';
import { PrismaModule } from '../../prisma/prisma.module';

// PR-CONSULT-1 — Staff-roles module.
//
// Pure plumbing: exports the StaffRolesGuard so the other staff
// modules can plug it onto their controllers. No controllers /
// services of its own.
@Module({
  imports:   [PrismaModule],
  providers: [StaffRolesGuard],
  exports:   [StaffRolesGuard],
})
export class StaffRolesModule {}
