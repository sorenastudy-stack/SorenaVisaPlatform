import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { OwnerOnly, StaffRoles } from '../roles/staff-roles.decorator';
import { OwnerApprovalService } from './owner-approval.service';
import {
  CreateApprovalRequestDto,
  DecisionDto,
} from './dto/owner-approval.dto';
import {
  OwnerApprovalCreateRateLimitGuard,
  OwnerApprovalDecisionRateLimitGuard,
} from './guards/owner-approval-rate-limit.guards';

// PR-CONSULT-1 — Owner-approval controller.
//
// SUPER_ADMIN creates pending requests (rate-limited); OWNER lists
// pending, approves, or rejects (rate-limited). ADMIN gets 403 on
// every route — the staff-roles guard rejects them via the
// @StaffRoles decorator on each method.
@Controller('api/staff/owner-approval')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class OwnerApprovalController {
  constructor(private readonly approval: OwnerApprovalService) {}

  @Post()
  @StaffRoles('SUPER_ADMIN')
  @UseGuards(OwnerApprovalCreateRateLimitGuard)
  create(@Req() req: any, @Body() body: CreateApprovalRequestDto) {
    return this.approval.requestApproval({
      requestedById: req.user.userId,
      actionType:    body.actionType as never,
      payload:       body.payload,
      reason:        body.reason,
    });
  }

  @Get('pending')
  @OwnerOnly()
  pending() {
    return this.approval.listPending();
  }

  @Get('mine')
  @StaffRoles('SUPER_ADMIN', 'OWNER')
  mine(@Req() req: any) {
    return this.approval.listMyRequests(req.user.userId);
  }

  @Post(':id/approve')
  @OwnerOnly()
  @UseGuards(OwnerApprovalDecisionRateLimitGuard)
  approve(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.approval.approve(id, req.user.userId, body.decisionNote);
  }

  @Post(':id/reject')
  @OwnerOnly()
  @UseGuards(OwnerApprovalDecisionRateLimitGuard)
  reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.approval.reject(id, req.user.userId, body.decisionNote);
  }
}
