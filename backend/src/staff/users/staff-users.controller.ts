import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  UpdateStaffProfileDto,
  SetSecondaryRolesDto,
} from './dto/staff-users.dto';
import {
  UpdateProfileRateLimitGuard,
  HardDeleteRateLimitGuard,
} from './guards/staff-users-rate-limit.guards';

// PR-CONSULT-1 — Staff-user CRUD controller.
//
// Destructive actions (create, change-role, deactivate) route
// through the owner-or-enqueue helper: OWNER executes inline,
// SUPER_ADMIN enqueues for OWNER approval, ADMIN gets 403.
// Non-destructive routes (list, detail, reactivate) are direct.
//
// PR-CONSULT-4 added PATCH `/:id` (profile edit, inline for OWNER +
// SUPER_ADMIN) and DELETE `/:id` (hard delete — OWNER inline,
// SUPER_ADMIN enqueues HARD_DELETE_STAFF). Both new routes carry
// db-count rate-limit guards because they hit sensitive paths.
@Controller('api/staff/users')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffUsersController {
  constructor(private readonly users: StaffUsersService) {}

  // PR-CONSULT-4: optional ?archived=false|true|all. Default false.
  // `?active=` from PR-CONSULT-1 isn't a real query param on this
  // route (the list previously returned every staff row); the
  // frontend filters client-side, so no alias-handling needed.
  @Get()
  @AdminTier()
  list(@Query('archived') archived?: string) {
    const norm = archived === 'true' || archived === 'all' ? archived : 'false';
    return this.users.list({ archived: norm as 'false' | 'true' | 'all' });
  }

  @Get(':id')
  @AdminTier()
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  // Create staff. OWNER inline. SUPER_ADMIN enqueues. ADMIN 403.
  // PR-CONSULT-4: now also requires mobileNumber + countryOfResidence
  // and accepts optional address + emergencyContact. The encrypted
  // columns are handled inside the service.
  @Post()
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  async create(@Req() req: any, @Body() body: CreateStaffUserDto) {
    if (req.user.role === 'OWNER') {
      const { user, tempPassword } = await this.users.createStaffUserAsOwner({
        email:              body.email,
        fullName:           body.fullName,
        role:               body.role,
        mobileNumber:       body.mobileNumber,
        countryOfResidence: body.countryOfResidence,
        address:            body.address,
        emergencyContact:   body.emergencyContact,
        actorId:            req.user.userId,
      });
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
      payload: {
        email:              body.email,
        fullName:           body.fullName,
        role:               body.role,
        mobileNumber:       body.mobileNumber,
        countryOfResidence: body.countryOfResidence,
        address:            body.address,
        emergencyContact:   body.emergencyContact,
      },
      reason: body.reason,
    });
  }

  // PR-CONSULT-4: edit profile. Both OWNER and SUPER_ADMIN inline —
  // no approval queue. Email rotation is OK (409 if duplicate). The
  // service encrypts mobile / address / emergencyContact before
  // persist.
  @Patch(':id')
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  @UseGuards(UpdateProfileRateLimitGuard)
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateStaffProfileDto,
  ) {
    return this.users.updateProfile({
      targetId: id,
      actorId:  req.user.userId,
      patch: {
        name:               body.name,
        email:              body.email,
        mobileNumber:       body.mobileNumber,
        countryOfResidence: body.countryOfResidence,
        address:            body.address,
        emergencyContact:   body.emergencyContact,
      },
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

  // Set a staff user's SECONDARY roles (WIDEN access only — never `role`).
  // OWNER-ONLY: @StaffRoles('OWNER') checks the PRIMARY role, so a secondary
  // OWNER can't reach this grant surface (no escalation path). Rate-limited.
  // The service blocks self-grant, whitelists roles to the UserRole enum,
  // strips the primary role, and audits before→after.
  @Patch(':id/secondary-roles')
  @StaffRoles('OWNER')
  @UseGuards(UpdateProfileRateLimitGuard)
  setSecondaryRoles(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetSecondaryRolesDto,
  ) {
    return this.users.setSecondaryRoles({
      targetId:       id,
      actorId:        req.user.userId,
      secondaryRoles: body.secondaryRoles,
    });
  }

  // Deactivate (archive in PR-CONSULT-4 UI). OWNER inline. SUPER_ADMIN
  // enqueues. Endpoint name unchanged for backward compatibility.
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

  // Reactivate (restore from archive in PR-CONSULT-4 UI).
  @Post(':id/reactivate')
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  reactivate(@Req() req: any, @Param('id') id: string) {
    return this.users.reactivate(id, req.user.userId);
  }

  // PR-CONSULT-4: hard delete. OWNER inline; SUPER_ADMIN enqueues
  // HARD_DELETE_STAFF. The service snapshots audit attribution +
  // closes / deletes assignments before removing the user row.
  @Delete(':id')
  @StaffRoles('OWNER', 'SUPER_ADMIN')
  @UseGuards(HardDeleteRateLimitGuard)
  async hardDelete(@Req() req: any, @Param('id') id: string) {
    if (req.user.role === 'OWNER') {
      return this.users.hardDeleteStaffAsOwner({
        targetId: id,
        actorId:  req.user.userId,
      });
    }
    return this.users.ownerOrEnqueue({
      callerRole: req.user.role,
      callerId:   req.user.userId,
      actionType: 'HARD_DELETE_STAFF',
      payload:    { userId: id },
    });
  }
}
