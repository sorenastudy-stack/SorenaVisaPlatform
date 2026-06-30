import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { AdminTier } from '../roles/staff-roles.decorator';
import { AdvisersService } from './advisers.service';
import { UpdateAdviserProfileDto, ReplaceAvailabilityDto } from './dto/advisers.dto';

// PR-BOOKING-ADMIN-A — adviser management endpoints.
//
// Mounted at /staff/advisers, admin-tier only (OWNER/SUPER_ADMIN/ADMIN)
// via @AdminTier() + StaffRolesGuard (which also enforces the staff
// active-status check). Configures booking for existing LIA/CONSULTANT
// users; it does not create users.
@Controller('staff/advisers')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
@AdminTier()
export class AdvisersController {
  constructor(private readonly service: AdvisersService) {}

  // GET /staff/advisers — list adviser-eligible users + booking summary.
  @Get()
  list() {
    return this.service.list();
  }

  // GET /staff/advisers/:id — one adviser's full config + weekly windows.
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  // PATCH /staff/advisers/:id — update languages / timezone / types / active.
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdviserProfileDto) {
    return this.service.updateProfile(id, dto);
  }

  // PUT /staff/advisers/:id/availability — replace the full weekly set.
  @Put(':id/availability')
  replaceAvailability(@Param('id') id: string, @Body() dto: ReplaceAvailabilityDto) {
    return this.service.replaceAvailability(id, dto.windows);
  }
}
