import { IsOptional, IsString, MaxLength } from 'class-validator';

// PR-STAFF-HR (Phase 3) — admin sets a staff member's job description.
// Empty/omitted text clears it (stored as null).
export class SetJobDescriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  text?: string;
}
