import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Option 1 step 3a — Body for PATCH /cases/:id/owner.
//
// Mirrors ManualReassignLiaDto. `ownerId: null` clears the assignment;
// `ownerId: string` reassigns to a User whose role === 'CONSULTANT'
// (the "Admission Specialist" externally — see frontend relabel; the
// code enum stays CONSULTANT). `reason` is required either way and
// lands on the audit row's reasonLength.

export class ManualReassignOwnerDto {
  @IsOptional()
  @IsString()
  ownerId?: string | null;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
