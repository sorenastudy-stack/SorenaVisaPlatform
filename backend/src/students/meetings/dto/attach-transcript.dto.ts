// PR-DASH-3 — POST /api/consultant/meetings/:id/transcript-metadata DTO.
//
// Mirrors PR-13/PR-14 file-metadata pattern: NO bytes accepted.
// MIME whitelist + 25MB cap + 255-char filename cap enforced at the
// DTO layer; the service replaces any existing transcript row in a
// single transaction.
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Per spec: audio + video + text + PDF. Markdown / JSON are NOT in
// this allowlist (those were the PR-DASH-1-era draft — the final
// PR-DASH-3 spec dropped them because transcripts are recordings or
// human-readable text only).
const TRANSCRIPT_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'video/mp4',
  'video/webm',
  'text/plain',
  'text/vtt',
  'application/pdf',
];

const TRANSCRIPT_MAX_SIZE = 25 * 1024 * 1024;

export class AttachTranscriptDto {
  @IsString() @MinLength(1) @MaxLength(255)
  originalFilename!: string;

  @IsString()
  @IsIn(TRANSCRIPT_MIME_TYPES, {
    message:
      'mimeType must be one of: audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/ogg, video/mp4, video/webm, text/plain, text/vtt, application/pdf',
  })
  mimeType!: string;

  @IsInt() @Min(1)
  @Max(TRANSCRIPT_MAX_SIZE, {
    message: 'sizeBytes must be 25MB (26214400) or smaller',
  })
  sizeBytes!: number;
}
