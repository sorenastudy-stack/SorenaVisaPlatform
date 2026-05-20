// PR-DASH-3 — PATCH /api/consultant/meetings/:id DTO.
//
// All fields optional; studentId is intentionally NOT exposed for
// reassignment (spec rule: "cannot change studentId"). The status
// enum is not patchable here either — separate /cancel and
// /complete endpoints handle transitions atomically (cancelledAt /
// cancelledReason for CANCELLED, etc.).
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VisaMeetingTypeDto } from './create-meeting.dto';

export class UpdateMeetingDto {
  @IsOptional() @IsISO8601()
  scheduledAt?: string;

  @IsOptional() @IsInt() @Min(5) @Max(240)
  durationMinutes?: number;

  @IsOptional() @IsEnum(VisaMeetingTypeDto)
  meetingType?: VisaMeetingTypeDto;

  @IsOptional() @IsString() @MaxLength(2000)
  locationOrLink?: string | null;

  @IsOptional() @IsString() @MaxLength(5000)
  agenda?: string | null;
}

export class CancelMeetingDto {
  // Cleartext label per spec; not encrypted.
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
