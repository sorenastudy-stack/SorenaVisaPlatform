// PR-DASH-3 — PUT /api/consultant/meetings/:id/transcript-notes DTO.
//
// Up to 50,000 chars (per spec). Encrypted at the service layer.
import { IsString, MaxLength } from 'class-validator';

export class TranscriptNotesDto {
  @IsString() @MaxLength(50_000)
  transcriptNotes!: string;
}
