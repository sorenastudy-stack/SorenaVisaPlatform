import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffPhotoModule } from '../photos/staff-photo.module';
import { StaffCasesController } from './staff-cases.controller';
import { StaffCasesService } from './staff-cases.service';

// PR-CONSULT-2 — Staff cases module.
@Module({
  imports:     [PrismaModule, StaffRolesModule, StaffPhotoModule],
  controllers: [StaffCasesController],
  providers:   [StaffCasesService],
})
export class StaffCasesModule {}
