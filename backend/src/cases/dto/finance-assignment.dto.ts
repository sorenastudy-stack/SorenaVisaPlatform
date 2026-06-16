import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Option 1 step 4b — Body for PATCH /cases/:id/finance.
//
// Mirrors ManualReassignLiaDto / ManualReassignOwnerDto. `financeId:
// null` clears the assignment; `financeId: string` reassigns to a
// User whose role === 'FINANCE'. `reason` is required either way
// and lands on the audit row's reasonLength.

export class ManualReassignFinanceDto {
  @IsOptional()
  @IsString()
  financeId?: string | null;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
