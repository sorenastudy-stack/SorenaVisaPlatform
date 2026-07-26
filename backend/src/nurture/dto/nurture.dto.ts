import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class EnrollNurtureDto {
  @IsString()
  leadId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class StopNurtureDto {
  @IsString()
  leadId!: string;
}

export class CompleteCallTaskDto {
  @IsIn(['DONE', 'SKIPPED'])
  status!: 'DONE' | 'SKIPPED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outcomeNotes?: string;
}

export class UnsubscribeDto {
  @IsString()
  token!: string;
}

export class NurtureOverrideDto {
  @IsIn(['ADVANCE', 'POSTPONE'])
  direction!: 'ADVANCE' | 'POSTPONE';

  @IsString()
  @MaxLength(500)
  reason!: string;

  // Required for POSTPONE — how many days to hold nurturing (bounded, not indefinite).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  holdDays?: number;
}
