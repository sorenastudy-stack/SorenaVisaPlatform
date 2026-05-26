import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// PR-LIA-2 — Body for PATCH /cases/:id/lia.
//
// `liaId: null` clears the assignment. `liaId: string` reassigns to
// the target LIA (the service validates: exists, role='LIA', active,
// not archived). `reason` is required either way and lands on the
// audit row.

export class ManualReassignLiaDto {
  // Nullable on purpose — class-validator's @IsOptional covers `undefined`,
  // and an empty payload field of `null` is allowed through by the
  // global ValidationPipe with `transform: true`.
  @IsOptional()
  @IsString()
  liaId?: string | null;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
