import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffMeController } from './staff-me.controller';
import { StaffMeService } from './staff-me.service';

// PR-CONSULT-2 — Tiny module bundling the `/api/staff/me` endpoint.
@Module({
  imports:     [PrismaModule, StaffRolesModule],
  controllers: [StaffMeController],
  providers:   [StaffMeService],
})
export class StaffMeModule {}
