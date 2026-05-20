import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles, AdminTier } from '../roles/staff-roles.decorator';
import { StaffUsersService } from './staff-users.service';
import {
  CreateStaffUserDto,
  ChangeRoleDto,
  DeactivateStaffDto,
} from './dto/staff-users.dto';

// PR-CONSULT-1 — Staff-user CRUD controller.
//
// Destructive actions (create, change-role, deactivate) route
// through the owner-or-enqueue helper: OWNER executes inline,
// SUPER_ADMIN enqueues for OWNER approval, ADMIN gets 403.
// Non-destructive routes (list, detail, reactivate) are direct.
@Controller('api/staff/users')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffUsersController {
  constructor(private readonly users: StaffUsersService) {}

  @Get()
  @AdminTier()
  list() {
    return this.users.list();
  }

  @Get(':id')
  @AdminTier()
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  // Create staff. OWNER inline. SUPER_ADMIN enqueues. ADMIN 403.
  @Post()
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  async create(@Req() req: any, @Body() body: CreateStaffUserDto) {
    if (req.user.role === 'OWNER') {
      const { user, tempPassword } = await this.users.createStaffUserAsOwner({
        email:    body.email,
        fullName: body.fullName,
        role:     body.role,
        actorId:  req.user.userId,
      });
      // Surface the temp password so the OWNER can share it
      // out-of-band. Future PR will email it directly.
      return {
        status:       'EXECUTED' as const,
        userId:       user.id,
        email:        user.email,
        role:         user.role,
        tempPassword,
      };
    }
    return this.users.ownerOrEnqueue({
      callerRole: req.user.role,
      callerId:   req.user.userId,
      actionType: 'CREATE_STAFF_USER',
      payload:    { email: body.email, fullName: body.fullName, role: body.role },
      reason:     body.reason,
    });
  }

  // Change a staff user's role. OWNER inline. SUPER_ADMIN enqueues.
  @Patch(':id/role')
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  async changeRole(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ChangeRoleDto,
  ) {
    return this.users.ownerOrEnqueue({
      callerRole: req.user.role,
      callerId:   req.user.userId,
      actionType: 'CHANGE_STAFF_ROLE',
      payload:    { userId: id, newRole: body.newRole },
      reason:     body.reason,
    });
  }

  // Deactivate. OWNER inline. SUPER_ADMIN enqueues.
  @Post(':id/deactivate')
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  async deactivate(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: DeactivateStaffDto,
  ) {
    return this.users.ownerOrEnqueue({
      callerRole: req.user.role,
      callerId:   req.user.userId,
      actionType: 'DEACTIVATE_STAFF',
      payload:    { userId: id },
      reason:     body.reason,
    });
  }

  // Reactivate is non-destructive — OWNER and SUPER_ADMIN both
  // execute directly. ADMIN still 403.
  @Post(':id/reactivate')
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  reactivate(@Req() req: any, @Param('id') id: string) {
    return this.users.reactivate(id, req.user.userId);
  }
}
