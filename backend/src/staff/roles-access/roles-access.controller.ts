import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesAccessService, RolesAccessReport } from './roles-access.service';
import { UserRole } from '@prisma/client';

// PR-ROLES-REFERENCE — GET /staff/roles-access
//
// OWNER/SUPER_ADMIN only. It is a complete map of the platform's permission
// surface, which is useful to whoever administers access and useful to nobody
// else — and a full route inventory is exactly the sort of thing not to hand to
// every authenticated caller.
@Controller('staff/roles-access')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesAccessController {
  constructor(private readonly service: RolesAccessService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN')
  get(): RolesAccessReport {
    // Roles come from the Prisma enum, so a role that exists but has been
    // granted nothing still appears — with zero routes, which is itself the
    // answer someone is usually looking for.
    return this.service.build(Object.values(UserRole) as string[]);
  }
}
