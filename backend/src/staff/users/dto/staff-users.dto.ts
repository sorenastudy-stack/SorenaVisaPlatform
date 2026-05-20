// PR-CONSULT-1 — Staff-user CRUD DTOs.
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Valid staff roles (any UserRole that isn't STUDENT). The list
// includes OWNER for the rare case where an OWNER promotes another
// user to OWNER — the OWNER-only check on the route still applies.
export enum StaffRoleDto {
  OWNER       = 'OWNER',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN       = 'ADMIN',
  LIA         = 'LIA',
  CONSULTANT  = 'CONSULTANT',
  SUPPORT     = 'SUPPORT',
  FINANCE     = 'FINANCE',
}

export class CreateStaffUserDto {
  @IsEmail() @MaxLength(255)
  email!: string;

  @IsString() @MinLength(1) @MaxLength(255)
  fullName!: string;

  @IsEnum(StaffRoleDto)
  role!: StaffRoleDto;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class ChangeRoleDto {
  @IsEnum(StaffRoleDto)
  newRole!: StaffRoleDto;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class DeactivateStaffDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
