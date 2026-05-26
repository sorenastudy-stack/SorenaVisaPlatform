import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// PR-LIA-8 — DTOs for the five visa-lifecycle endpoints.
//
// Outcome is encoded in the URL (POST /visa/issue vs POST /visa/decline)
// rather than the body, so we don't need to validate it here. The
// service double-checks the path matches the dto and rejects mismatches.

// POST /cases/:id/visa/issue (multipart). class-validator runs AFTER
// multer parses the multipart body; the visa PDF lives on req.file.
// Dates arrive as ISO strings and class-transformer @Type coerces
// them to Date objects.
export class IssueVisaDto {
  @Type(() => Date)
  @IsDate()
  visaStartDate!: Date;

  @Type(() => Date)
  @IsDate()
  visaEndDate!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// POST /cases/:id/visa/decline — JSON only. Decline reason is
// confidential and never surfaces to the client. Stored encrypted
// via CryptoService on Visa.declineReasonEncrypted.
export class DeclineVisaDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  declineReason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// PATCH /cases/:id/visa — text-only edit. The visa file itself is
// NOT editable here (LIA must revert + re-issue to swap the document).
// Either approval fields OR the decline reason are editable, never
// both — service routes by the row's existing outcome.
export class EditVisaDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  visaStartDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  visaEndDate?: Date;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  declineReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// POST /cases/:id/visa/revert — destructive un-issue. Reason mirrors
// PR-LIA-7's RevertInzSubmissionDto.
export class RevertVisaDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
