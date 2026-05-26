import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// PR-LIA-7 — DTOs for the three INZ-submission endpoints.

// POST /cases/:id/inz-submission (multipart). class-validator runs
// AFTER multer has parsed the multipart body, so the `file` lives on
// req.file (not on the DTO). Text fields come through here.
export class SubmitToInzDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  inzApplicationNumber!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  submittedAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// PATCH /cases/:id/inz-submission — text-only edit; receipt is NOT
// editable on this endpoint (LIA must revert + resubmit to swap the
// receipt).
export class EditInzSubmissionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  inzApplicationNumber?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  submittedAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// POST /cases/:id/inz-submission/revert
export class RevertInzSubmissionDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
