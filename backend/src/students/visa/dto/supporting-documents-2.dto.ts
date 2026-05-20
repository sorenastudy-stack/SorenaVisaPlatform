// PR-VISA14 — Step 14 (Supporting documents page 2) request DTOs.
//
// File storage is still deferred. The 17 new VisaSupportingDocumentType
// values reuse PR-13's PUT /students/me/visa/supporting-documents/
// metadata endpoint — bytes never reach the backend.
//
// All parent fields are individually optional so a draft save with
// partial data works; the conditional-required rules (at least one
// fundsSource*, scholarship triplet, declaration must be true to
// advance, etc.) live in visa.service.saveSupportingDocuments2.
// Server-side cascade clearing is applied there too.
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Mirror the Prisma enums.
export enum TuitionPaymentMethodDto {
  SELF_PAID                     = 'SELF_PAID',
  PARTNER_PROVIDER_OR_GOVT_LOAN = 'PARTNER_PROVIDER_OR_GOVT_LOAN',
  THIRD_PARTY_SPONSOR           = 'THIRD_PARTY_SPONSOR',
  SCHOLARSHIP                   = 'SCHOLARSHIP',
}
export enum OtherEvidenceTypeDto {
  COVER_LETTER              = 'COVER_LETTER',
  STATEMENT_OF_PURPOSE      = 'STATEMENT_OF_PURPOSE',
  ADDITIONAL_FUNDS_EVIDENCE = 'ADDITIONAL_FUNDS_EVIDENCE',
  FAMILY_TIES_EVIDENCE      = 'FAMILY_TIES_EVIDENCE',
  OTHER                     = 'OTHER',
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// PATCH /students/me/visa/supporting-documents-2 — 28 parent-row
// fields. All optional individually so a draft save works; the
// service applies conditional-required + cascade-clear rules.
export class SupportingDocuments2Dto {
  // Tuition
  @IsOptional() @IsBoolean()
  tuitionFeesPaid?: boolean | null;

  @IsOptional() @IsEnum(TuitionPaymentMethodDto)
  tuitionPaymentMethod?: TuitionPaymentMethodDto | null;

  // Funds source (5 booleans)
  @IsOptional() @IsBoolean() fundsSourceSavings?: boolean | null;
  @IsOptional() @IsBoolean() fundsSourceNZSponsor?: boolean | null;
  @IsOptional() @IsBoolean() fundsSourceInz1014?: boolean | null;
  @IsOptional() @IsBoolean() fundsSourcePrepaidAccom?: boolean | null;
  @IsOptional() @IsBoolean() fundsSourceScholarship?: boolean | null;

  // Outward travel source (4 booleans)
  @IsOptional() @IsBoolean() outwardSourceSufficientFunds?: boolean | null;
  @IsOptional() @IsBoolean() outwardSourceInz1014?: boolean | null;
  @IsOptional() @IsBoolean() outwardSourcePrepaidBooking?: boolean | null;
  @IsOptional() @IsBoolean() outwardSourceScholarship?: boolean | null;

  // Funds format (5 booleans — shown only when fundsSourceSavings = true)
  @IsOptional() @IsBoolean() fundsFormatBankAccount?: boolean | null;
  @IsOptional() @IsBoolean() fundsFormatProvidentFund?: boolean | null;
  @IsOptional() @IsBoolean() fundsFormatEducationLoan?: boolean | null;
  @IsOptional() @IsBoolean() fundsFormatFixedTermDeposit?: boolean | null;
  @IsOptional() @IsBoolean() fundsFormatOther?: boolean | null;

  // Savings sources (4 booleans — shown only when fundsFormatBankAccount = true)
  @IsOptional() @IsBoolean() savingsSourceWages?: boolean | null;
  @IsOptional() @IsBoolean() savingsSourceSelfEmployment?: boolean | null;
  @IsOptional() @IsBoolean() savingsSourceRentalIncome?: boolean | null;
  @IsOptional() @IsBoolean() savingsSourceOther?: boolean | null;

  // Encrypted free-text PII
  @IsOptional() @IsString() @MaxLength(5000)
  depositExplanation?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  scholarshipName?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  scholarshipOrganisation?: string | null;

  // Work rights
  @IsOptional() @IsBoolean() studyIs120CreditsOrMore?: boolean | null;
  @IsOptional() @IsBoolean() courseRequiresPracticalWork?: boolean | null;

  // English test gate
  @IsOptional() @IsBoolean() tookEnglishTest?: boolean | null;

  // Final declaration
  @IsOptional() @IsBoolean() declarationChecked?: boolean | null;
}

// PUT /students/me/visa/supporting-documents-2/other-evidence — one
// entry, create-or-update by optional id. If id is omitted a new row
// is created; if provided the row with that id is updated. customLabel
// is required iff evidenceType = OTHER (service enforces). File
// metadata follows the same shape as PR-13's SupportingDocumentMetadataDto.
export class OtherEvidenceEntryDto {
  // Optional — present when updating an existing entry, omitted on create.
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64)
  id?: string;

  @IsEnum(OtherEvidenceTypeDto)
  evidenceType!: OtherEvidenceTypeDto;

  // Required iff evidenceType = OTHER. Service enforces.
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300)
  customLabel?: string | null;

  @IsString() @MinLength(1) @MaxLength(500)
  originalFilename!: string;

  @IsString() @IsIn(ACCEPTED_MIME_TYPES, {
    message: 'mimeType must be one of: application/pdf, image/jpeg, image/png',
  })
  mimeType!: string;

  @IsInt() @Min(1) @Max(MAX_SIZE_BYTES, {
    message: 'sizeBytes must be 10MB (10485760) or smaller',
  })
  sizeBytes!: number;
}
