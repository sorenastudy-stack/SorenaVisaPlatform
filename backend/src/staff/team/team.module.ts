import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { StaffPhotoModule } from '../photos/staff-photo.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

// PR-BOOKING-ADMIN-A — adviser management (booking config + weekly hours).
@Module({
  imports: [PrismaModule, StaffRolesModule, StaffPhotoModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
