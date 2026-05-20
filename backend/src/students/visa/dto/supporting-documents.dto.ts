// PR-VISA13 — Step 13 (Supporting documents page 1) request DTOs.
//
// File storage is deferred to a later PR — the backend never
// receives the file bytes. The browser extracts originalFilename /
// mimeType / sizeBytes from the File object and PUTs only those
// primitives via /students/me/visa/supporting-documents/metadata.
//
// Cross-field rules — "countryOfResidence required when
// livingInDifferentCountry = true", "RESIDENCE_VISA row required
// when living abroad", "MILITARY_RECORD required when the Section 10
// gate = true", "AUTHORITY_DOC required when completingOnBehalf =
// true", "PASSPORT required to complete the step" — live in
// visa.service.saveSupportingDocuments rather than @ValidateIf
// chains, matching the PR-10..PR-12 pattern.
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Mirror the Prisma enum by value so the validator rejects anything
// off-list at the DTO layer.
export enum VisaSupportingDocumentTypeDto {
  PASSPORT        = 'PASSPORT',
  NATIONAL_ID     = 'NATIONAL_ID',
  RESIDENCE_VISA  = 'RESIDENCE_VISA',
  MILITARY_RECORD = 'MILITARY_RECORD',
  TRAVEL_HISTORY  = 'TRAVEL_HISTORY',
  AUTHORITY_DOC   = 'AUTHORITY_DOC',
}

// 10MB cap matches the INZ page-1 guidance copy. Anything larger is
// rejected at the DTO layer so the upload UX surfaces the error
// before the metadata row gets written.
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

// Accepted upload MIME types per the page-1 guidance: PDF + images.
// Anything else is rejected client-side and (defensively) here.
const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// PATCH /students/me/visa/supporting-documents — three parent-row
// fields. All optional individually so a draft save with partial
// fields works; the "required when…" semantics are conditional and
// enforced in the service.
export class SupportingDocumentsDto {
  @IsOptional()
  @IsBoolean()
  livingInDifferentCountry?: boolean | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  countryOfResidence?: string | null;

  @IsOptional()
  @IsBoolean()
  areAllDocsInEnglish?: boolean | null;
}

// PUT /students/me/visa/supporting-documents/metadata — one
// metadata row, replace-on-upload by (visaApplicationId,
// documentType). The DTO enforces shape + MIME allowlist + 10MB
// cap; the service enforces the row-key uniqueness via the
// transactional delete-then-insert pattern.
export class SupportingDocumentMetadataDto {
  @IsEnum(VisaSupportingDocumentTypeDto)
  documentType!: VisaSupportingDocumentTypeDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  originalFilename!: string;

  @IsString()
  @IsIn(ACCEPTED_MIME_TYPES, {
    message: 'mimeType must be one of: application/pdf, image/jpeg, image/png',
  })
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_SIZE_BYTES, { message: 'sizeBytes must be 10MB (10485760) or smaller' })
  sizeBytes!: number;
}
