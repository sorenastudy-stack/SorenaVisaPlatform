// PR-VISA12 — Step 12 (Immigration assistance) request DTO.
//
// The global ValidationPipe runs these decorators automatically.
// Cross-field rules — "capacity required when gate = true",
// "five adviser fields required when capacity ∈ {ADVISER_SET}",
// "adviser fields must be null otherwise", "everything null when
// gate = false" — live in visa.service.saveImmigrationAssistance
// rather than @ValidateIf chains, so the error messages can be
// field-specific and match the PR-10 / PR-11 style.
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Mirror the Prisma enum by value so the validator rejects anything
// off-list at the DTO layer (the service layer would catch it via
// the Prisma client too, but rejecting early gives a cleaner 400).
export enum ImmigrationAssistanceCapacityDto {
  LICENSED_IMMIGRATION_ADVISER = 'LICENSED_IMMIGRATION_ADVISER',
  EXEMPT_PERSON                = 'EXEMPT_PERSON',
  FAMILY_MEMBER                = 'FAMILY_MEMBER',
  FRIEND                       = 'FRIEND',
  OTHER                        = 'OTHER',
}

export class ImmigrationAssistanceDto {
  @IsBoolean()
  completingOnBehalf!: boolean;

  // Required iff completingOnBehalf === true. Service enforces.
  @IsOptional()
  @IsEnum(ImmigrationAssistanceCapacityDto)
  capacity?: ImmigrationAssistanceCapacityDto | null;

  // The five adviser fields. Required iff capacity ∈
  // {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}; otherwise must be
  // absent / null. Service enforces both directions.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  adviserNumber?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  adviserFullName?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  adviserEmail?: string | null;

  // Phone format: digits, plus, spaces only; max 16 chars. Per the
  // INZ helper text on the page.
  @IsOptional()
  @IsString()
  @Matches(/^[+\d\s]{1,16}$/, {
    message: 'adviserContactNumber must contain only digits, +, spaces (max 16 characters)',
  })
  adviserContactNumber?: string | null;

  @IsOptional()
  @IsBoolean()
  adviserIsPrimaryContact?: boolean | null;
}
