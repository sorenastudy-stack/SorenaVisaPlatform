import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Option 1 step 4b — Body for PATCH /cases/:id/support.
//
// Mirrors ManualReassignLiaDto / ManualReassignOwnerDto. `supportId:
// null` clears the assignment; `supportId: string` reassigns to a
// User whose role === 'SUPPORT'. `reason` is required either way
// and lands on the audit row's reasonLength.

export class ManualReassignSupportDto {
  @IsOptional()
  @IsString()
  supportId?: string | null;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
