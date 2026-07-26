import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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
