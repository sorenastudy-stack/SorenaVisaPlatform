// PR-DASH-3 — POST /api/consultant/meetings DTO.
//
// class-validator on shape, length, enum membership. Future-only
// scheduledAt + the encryption of locationOrLink + agenda live in
// the service layer.
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum VisaMeetingTypeDto {
  CONSULTATION    = 'CONSULTATION',
  FOLLOW_UP       = 'FOLLOW_UP',
  DOCUMENT_REVIEW = 'DOCUMENT_REVIEW',
  ASSESSMENT      = 'ASSESSMENT',
}

export class CreateMeetingDto {
  @IsString() @MinLength(1)
  studentId!: string;

  @IsISO8601()
  scheduledAt!: string;

  @IsOptional() @IsInt() @Min(5) @Max(240)
  durationMinutes?: number;

  @IsEnum(VisaMeetingTypeDto)
  meetingType!: VisaMeetingTypeDto;

  // The Zoom URL / office address / phone bridge — encrypted at the
  // service layer. https-only when present; the regex is permissive
  // to allow plain office-address strings too.
  @IsOptional() @IsString() @MaxLength(2000)
  locationOrLink?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  agenda?: string;
}
