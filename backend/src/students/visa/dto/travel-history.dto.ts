// PR-VISA11 — Step 11 (Travel history) request DTO.
//
// The global ValidationPipe runs these decorators automatically.
// Cross-field rules — "≥1 entry required when gate = true", "no
// entries when gate = false", "otherPurpose required when purpose
// = OTHER", "exit date >= entered date" — live in
// visa.service.saveTravelHistory rather than @ValidateIf chains, so
// the smoke-test error messages can be field-specific and match the
// PR-10 style.
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Mirror the Prisma enums by value so the validator rejects anything
// off-list at the DTO layer (the service layer would catch it too via
// the Prisma client, but rejecting early gives cleaner 400 messages).
export enum ArrivalModeDto {
  AIR  = 'AIR',
  SEA  = 'SEA',
  LAND = 'LAND',
}
export enum PurposeOfTravelDto {
  EDUCATION = 'EDUCATION',
  TOURISM   = 'TOURISM',
  BUSINESS  = 'BUSINESS',
  FAMILY    = 'FAMILY',
  MEDICAL   = 'MEDICAL',
  TRANSIT   = 'TRANSIT',
  WORK      = 'WORK',
  OTHER     = 'OTHER',
}

export class TravelHistoryEntryDto {
  // Country / region the student travelled to — encrypted at the
  // service layer.
  @IsString() @MinLength(1) @MaxLength(200)
  destination!: string;

  @IsInt() @Min(1) @Max(12)
  dateEnteredMonth!: number;

  // 4-digit year. Upper bound checked against the current year in the
  // service (cleaner error than a static Max() that drifts each year).
  @IsInt() @Min(1900) @Max(9999)
  dateEnteredYear!: number;

  @IsOptional() @IsInt() @Min(1) @Max(12)
  dateExitedMonth?: number | null;

  @IsOptional() @IsInt() @Min(1900) @Max(9999)
  dateExitedYear?: number | null;

  @IsEnum(ArrivalModeDto)
  arrivalMode!: ArrivalModeDto;

  // Airport / port / land crossing — encrypted at the service layer.
  @IsString() @MinLength(1) @MaxLength(200)
  pointOfEntry!: string;

  @IsEnum(PurposeOfTravelDto)
  purposeOfTravel!: PurposeOfTravelDto;

  // Required iff purposeOfTravel === OTHER. The DTO layer only
  // enforces type + length cap; the conditional-required rule is in
  // the service so the error message can name the specific field.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  otherPurpose?: string | null;
}

export class TravelHistoryDto {
  @IsBoolean()
  hasTravelledInternationally!: boolean;

  // Required iff hasTravelledInternationally === true. The "at least
  // one when gate = true" + "empty when gate = false" rules live in
  // the service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TravelHistoryEntryDto)
  entries?: TravelHistoryEntryDto[];
}
