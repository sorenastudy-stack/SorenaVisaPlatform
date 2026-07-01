import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffHrController } from './staff-hr.controller';
import { StaffHrAdminController } from './staff-hr-admin.controller';
import { StaffHrService } from './staff-hr.service';

// PR-STAFF-HR (Phase 3) — staff HR: self-service (/staff/me/*) + admin
// management (/api/staff/users/:id/*, ADMIN tier).
@Module({
  imports: [PrismaModule, StaffRolesModule],
  controllers: [StaffHrController, StaffHrAdminController],
  providers: [StaffHrService],
})
export class StaffHrModule {}
