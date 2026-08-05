import {
  IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';
import { QualificationLevel, NZQFLevel } from '@prisma/client';

// PR-CURATION — direct Owner edit of an imported programme.
//
// WHITELIST, not a passthrough. The screen edits catalogue FACTS; it must not be
// able to reach the fields that decide whether a programme is student-visible or
// where it came from. Deliberately absent, and the reasons:
//
//   reviewStatus / isActive — owned by the activation endpoint, which runs the
//     "is a student already holding this programme" check first. Allowing them
//     here would route a toggle around that guard.
//   sourceRef / source     — provenance. Rewriting it would break the
//     idempotent re-import (it keys on sourceRef) and lose the audit trail back
//     to the workbook row.
//   coverImageUrl          — set only by the upload endpoint, which validates
//     the file and writes to R2. A free-text URL here would defeat that.
//   providerId             — moving a programme between institutions is not an
//     edit; it would silently reassign any attached applications.
//   aiPopulated / verifiedAt / verificationStatus — written by the automated
//     verification passes, not by hand.
export class UpdateProgrammeDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsEnum(QualificationLevel) level?: QualificationLevel;
  @IsOptional() @IsEnum(NZQFLevel) nzqfLevel?: NZQFLevel;
  @IsOptional() @IsString() @MaxLength(200) qualificationType?: string | null;
  @IsOptional() @IsString() @MaxLength(200) majorStrand?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subjectAreaRaw?: string | null;

  // Duration: structured months for matching, raw text for display. Both edit-
  // able because the source states duration in forms that do not always reduce
  // to a month count ("18 weeks", "1 year full-time or 2 years part-time").
  @IsOptional() @IsInt() @Min(1) @Max(120) durationMonths?: number | null;
  @IsOptional() @IsString() @MaxLength(200) durationText?: string | null;

  // Fees: parsed amount AND the institution's own wording. tuitionFeeNZD stays
  // nullable on purpose — a conditional fee must be allowed to have no number
  // rather than being forced to one the institution never published.
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) tuitionFeeNZD?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) tuitionFeeRaw?: string | null;
  @IsOptional() @IsString() @MaxLength(500) tuitionParseNote?: string | null;
  @IsOptional() @IsString() @MaxLength(100) feeBasis?: string | null;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) feeYear?: number | null;
  @IsOptional() @IsString() @MaxLength(100) fee2027Status?: string | null;

  @IsOptional() @IsString() @MaxLength(200) campusCity?: string | null;
  @IsOptional() @IsString() @MaxLength(100) deliveryMode?: string | null;
  @IsOptional() @IsBoolean() studentVisaSuitable?: boolean | null;

  // Intakes: structured months drive matching; the four raw columns are what the
  // institution published and are kept verbatim.
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(12, { each: true })
  intakeMonths?: number[];
  @IsOptional() @IsString() @MaxLength(1000) remaining2026Intakes?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) published2027Intakes?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) projected2027Intakes?: string | null;
  @IsOptional() @IsString() @MaxLength(500) intakeBasis2027?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) intakes2027Planning?: string | null;

  @IsOptional() @IsString() @MaxLength(4000) academicPrerequisites?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) englishRequirementRaw?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) otherRequirements?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) scholarshipNote?: string | null;

  @IsOptional() @IsString() @MaxLength(2000) descriptionEn?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) descriptionFa?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) programmeUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) verificationSourceUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

/**
 * Activation toggle. `confirm` is the Owner acknowledging the warning returned
 * when students already hold this programme — see deactivation guard.
 */
export class SetProgrammeActivationDto {
  @IsBoolean() active!: boolean;
  @IsOptional() @IsBoolean() confirm?: boolean;
}
