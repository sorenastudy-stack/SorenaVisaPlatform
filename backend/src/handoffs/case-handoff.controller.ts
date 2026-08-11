import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CaseSlot } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CaseHandoffService } from './case-handoff.service';

export class CreateHandoffDto {
  /** The stage the caller is handing FROM — they must hold it on this case. */
  @IsEnum(CaseSlot)
  fromSlot!: CaseSlot;

  /** Optional: hand to a named person instead of the load-balanced pick. */
  @IsOptional() @IsString()
  toUserId?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

// PR-HANDOFF — the explicit stage-to-stage handoff.
//
// The role gate here only says who may attempt a handoff at all. WHICH case
// they may hand off is decided in the service, by whether they actually hold
// the stage — a role check alone would let any caseworker push work into a
// colleague's queue on a case they have never touched.
const HANDOFF_ROLES = [
  'OWNER', 'SUPER_ADMIN', 'ADMIN',
  'CONSULTANT', 'CLIENT_CONSULTANT', 'SUPPORT', 'FINANCE', 'LIA',
] as const;

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CaseHandoffController {
  constructor(private readonly service: CaseHandoffService) {}

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
    };
  }

  // POST /cases/:id/handoff
  @Post('cases/:id/handoff')
  @Roles(...HANDOFF_ROLES)
  handOff(@Param('id') caseId: string, @Body() dto: CreateHandoffDto, @Req() req: any) {
    return this.service.handOff(caseId, dto.fromSlot, this.actor(req), {
      toUserId: dto.toUserId ?? null,
      note: dto.note ?? null,
    });
  }

  // GET /staff/handoffs/my-queue — open handoffs addressed to the caller.
  // No role gate beyond staff: the query is scoped to their own id, so the
  // answer for anyone else is simply an empty list.
  @Get('staff/handoffs/my-queue')
  @Roles(...HANDOFF_ROLES)
  myQueue(@Req() req: any) {
    return this.service.myQueue(this.actor(req).id);
  }
}
