import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Phase 1 (auto-assignment) — Body for PATCH /cases/:id/consultant.
//
// Mirrors ManualReassignSupportDto / ManualReassignOwnerDto. `consultantId:
// null` clears the assignment; `consultantId: string` reassigns to a User
// whose role === 'CLIENT_CONSULTANT'. `reason` is required either way and
// lands on the audit row's reasonLength.

export class ManualReassignConsultantDto {
  @IsOptional()
  @IsString()
  consultantId?: string | null;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
