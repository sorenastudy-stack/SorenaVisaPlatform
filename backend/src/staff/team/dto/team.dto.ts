import {
  IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsNotEmpty,
  Max, Min, ValidateNested, ArrayMaxSize, Matches, MaxLength,
  registerDecorator, ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { isValidLanguageCode } from '../../../common/language-codes';

// YYYY-MM-DD calendar date (the format the slot engine consumes directly).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Phase 2a — per-element ISO 639-1 validator, mirroring the IsCountryCode
// pattern in staff-users.dto.ts. Applied with `{ each: true }` so every entry
// in the `languages` array must be a valid lowercase two-letter code. This
// keeps staff `User.languages` in the same format as client
// `Contact.preferredLanguage` so consultant auto-assignment can compare them.
function IsLanguageCode(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isLanguageCode',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return isValidLanguageCode(value);
        },
        defaultMessage() {
          return `${propertyName} must be a valid ISO 639-1 language code (lowercase, e.g. "en", "fa")`;
        },
      },
    });
  };
}

// PR-BOOKING-ADMIN-A — adviser config DTOs.

// The bookable session types (subset of ConsultationType used for booking).
export const BOOKING_SESSION_TYPES = ['FREE_15', 'GAP_CLOSING', 'LIA'] as const;

export class UpdateStaffProfileDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsLanguageCode({ each: true })
  languages?: string[]; // ISO 639-1 codes (lowercase)

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

// PR-BOOKING-ADMIN-B — leave creation. Admin direct-set (→ APPROVED) reuses
// this; the staff self-request path (→ REQUESTED) reuses it too.
export class CreateStaffLeaveDto {
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

// PR-BOOKING-ADMIN-B slice 2 — admin approves/rejects a pending request.
export class DecideLeaveDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';
}
