// PR-CONSULT-1 — Staff-user CRUD DTOs.
// PR-CONSULT-4 — extended with staff-profile fields + a custom
// country-code validator backed by `i18n-iso-countries`.
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { isValidCountryCode } from '../../../common/country-codes';

// Valid staff roles. SALES is intentionally excluded — PR-CONSULT-4
// deprecated it. OWNER stays in the enum because the executor may
// receive it on edge-case re-promotion flows, but the controller
// blocks OWNER on the user-facing endpoints.
export enum StaffRoleDto {
  OWNER       = 'OWNER',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN       = 'ADMIN',
  LIA         = 'LIA',
  CONSULTANT  = 'CONSULTANT',
  // Phase 2a: the real client Consultant slot (Case.consultantId). Distinct
  // from CONSULTANT (the Admission Specialist on Case.ownerId).
  CLIENT_CONSULTANT = 'CLIENT_CONSULTANT',
  SUPPORT     = 'SUPPORT',
  FINANCE     = 'FINANCE',
}

// Phone-ish format. Allows +, digits, spaces, hyphens, parens — same
// shape every front-of-house form accepts. Anchored on both ends.
const PHONE_REGEX = /^[+0-9 ()\-]{5,32}$/;

// Custom class-validator decorator wrapping the country-code lookup
// from `common/country-codes`. Keeps validation on the DTO surface
// rather than scattering checks across the service layer.
function IsCountryCode(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCountryCode',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidCountryCode(value);
        },
        defaultMessage() {
          return `${propertyName} must be a valid ISO 3166-1 alpha-2 country code (uppercase)`;
        },
      },
    });
  };
}

// PR-CONSULT-4: mobile + country are required at create; address +
// emergencyContact are optional. Three of the four are encrypted at
// the service layer before persist.
export class CreateStaffUserDto {
  @IsEmail() @MaxLength(255)
  email!: string;

  @IsString() @MinLength(1) @MaxLength(255)
  fullName!: string;

  @IsEnum(StaffRoleDto)
  role!: StaffRoleDto;

  @IsString() @MinLength(5) @MaxLength(32)
  @Matches(PHONE_REGEX, { message: 'mobileNumber must contain only digits, spaces, +, -, and parens' })
  mobileNumber!: string;

  @IsString()
  @IsCountryCode()
  countryOfResidence!: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(200)
  emergencyContact?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class ChangeRoleDto {
  @IsEnum(StaffRoleDto)
  newRole!: StaffRoleDto;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

// Secondary roles WIDEN access only — never the primary `role`. Validated
// against the full UserRole enum (anything else → 400). The service strips the
// target's primary role and dedupes. OWNER-only endpoint.
export class SetSecondaryRolesDto {
  @IsArray()
  @IsEnum(UserRole, { each: true })
  secondaryRoles!: UserRole[];

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class DeactivateStaffDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

// PR-CONSULT-4: profile edit. Every field optional — the service
// only updates the ones present. `email` rotation is allowed but
// uniqueness is checked again at the DB layer (409 on dup).
export class UpdateStaffProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160)
  name?: string;

  @IsOptional() @IsEmail() @MaxLength(255)
  email?: string;

  @IsOptional() @IsString() @MinLength(5) @MaxLength(32)
  @Matches(PHONE_REGEX, { message: 'mobileNumber must contain only digits, spaces, +, -, and parens' })
  mobileNumber?: string;

  @IsOptional() @IsString() @IsCountryCode()
  countryOfResidence?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(200)
  emergencyContact?: string;
}
