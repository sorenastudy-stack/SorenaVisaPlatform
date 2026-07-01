import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

// PR-BOOKING-ADMIN-A — adviser management (booking config + weekly hours).
@Module({
  imports: [PrismaModule, StaffRolesModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
