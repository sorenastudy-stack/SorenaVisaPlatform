// PR-VISA13 — Step 13 (Supporting documents page 1) request DTOs.
//
// PR-FILES-2 — files now ride as multipart bytes via POST
// .../:documentType/file (per-upload child row). The legacy
// "metadata-only PUT" DTO is gone; what remains is the parent-flag
// PATCH DTO + the documentType enum (used by the upload route's
// path param and by client-side type validation).
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
  IsOptional,
  IsString,
  MaxLength,
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
