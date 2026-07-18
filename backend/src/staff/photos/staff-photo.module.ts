import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { R2Module } from '../../common/r2/r2.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffPhotoController } from './staff-photo.controller';
import { StaffPhotoService } from './staff-photo.service';

// PR-STAFF-PHOTOS — profile photos on R2. Exports StaffPhotoService so the
// identity endpoints (staff-me / staff-users / team) can derive a presigned
// photoUrl from a stored key.
@Module({
  imports: [PrismaModule, R2Module, StaffRolesModule],
  controllers: [StaffPhotoController],
  providers: [StaffPhotoService],
  exports: [StaffPhotoService],
})
export class StaffPhotoModule {}
