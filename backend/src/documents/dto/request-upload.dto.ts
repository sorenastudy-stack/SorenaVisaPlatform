import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// Documents step 3 — body for POST /cases/:caseId/documents/request-upload.
//
// The MIME whitelist and the 15 MB cap are enforced here so a bad
// request fails at the global ValidationPipe with a 400 + clear
// message before the service runs.

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MiB

export class RequestUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalName!: string;

  @IsString()
  @IsIn(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[], {
    message: `mimeType must be one of: ${ALLOWED_DOCUMENT_MIME_TYPES.join(', ')}`,
  })
  mimeType!: string;

  @IsInt()
  @Min(1, { message: 'sizeBytes must be a positive integer' })
  @Max(MAX_DOCUMENT_SIZE_BYTES, {
    message: `sizeBytes must not exceed ${MAX_DOCUMENT_SIZE_BYTES} bytes (15 MiB)`,
  })
  sizeBytes!: number;
}
