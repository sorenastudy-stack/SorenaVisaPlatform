import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { staffPermissions, StaffPermissions } from './staff-permissions';
import type { StaffRole } from '../roles/staff-roles.decorator';

// PR-CONSULT-2 — `/api/staff/me` service.
//
// Returns the signed-in staff user's snapshot. Used by the staff
// dashboard shell on every page load to populate the top bar and
// gate nav items / action buttons.
//
// `isActive` is derived from the StaffActiveStatus row (missing row
// = active, matches the StaffRolesGuard semantics).

export interface StaffMeSnapshot {
  id:          string;
  email:       string;
  fullName:    string;
  role:        StaffRole;
  isActive:    boolean;
  permissions: StaffPermissions;
}

@Injectable()
export class StaffMeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<StaffMeSnapshot> {
    const user = await this.prisma.user.findUnique({
      where:   { id: userId },
      include: { staffActiveStatus: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const isActive = user.staffActiveStatus?.isActive !== false;
    const role = user.role as StaffRole;

    return {
      id:          user.id,
      email:       user.email,
      fullName:    user.name,
      role,
      isActive,
      permissions: staffPermissions(role),
    };
  }
}
