import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { AdvisersController } from './advisers.controller';
import { AdvisersService } from './advisers.service';

// PR-BOOKING-ADMIN-A — adviser management (booking config + weekly hours).
@Module({
  imports: [PrismaModule, StaffRolesModule],
  controllers: [AdvisersController],
  providers: [AdvisersService],
})
export class AdvisersModule {}
