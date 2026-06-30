import {
  IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsNotEmpty,
  Max, Min, ValidateNested, ArrayMaxSize, Matches, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// YYYY-MM-DD calendar date (the format the slot engine consumes directly).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// PR-BOOKING-ADMIN-A — adviser config DTOs.

// The bookable session types (subset of ConsultationType used for booking).
export const BOOKING_SESSION_TYPES = ['FREE_15', 'GAP_CLOSING', 'LIA'] as const;

export class UpdateAdviserProfileDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  languages?: string[]; // ISO 639-1 codes

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string; // IANA zone

  @IsOptional()
  @IsArray()
  @IsIn(BOOKING_SESSION_TYPES as unknown as string[], { each: true })
  bookableSessionTypes?: Array<'FREE_15' | 'GAP_CLOSING' | 'LIA'>;

  @IsOptional()
  @IsBoolean()
  bookingActive?: boolean;
}

export class AvailabilityWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number; // 0 = Sunday … 6 = Saturday

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinute!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinute!: number;
}

export class ReplaceAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  windows!: AvailabilityWindowDto[];
}

// PR-BOOKING-ADMIN-B — admin sets adviser leave directly (created APPROVED).
export class CreateAdviserLeaveDto {
  @IsString()
  @Matches(YMD, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @IsString()
  @Matches(YMD, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
