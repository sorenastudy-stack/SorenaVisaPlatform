// PR-CONSULT-1 — Assignment DTOs.
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum VisaCaseRoleSlotDto {
  LIA        = 'LIA',
  CONSULTANT = 'CONSULTANT',
  SUPPORT    = 'SUPPORT',
  FINANCE    = 'FINANCE',
}

export class AutoAllocateDto {
  @IsString() @MinLength(1)
  caseId!: string;

  @IsEnum(VisaCaseRoleSlotDto)
  roleSlot!: VisaCaseRoleSlotDto;
}

export class ManualAssignDto {
  @IsString() @MinLength(1)
  caseId!: string;

  @IsEnum(VisaCaseRoleSlotDto)
  roleSlot!: VisaCaseRoleSlotDto;

  @IsString() @MinLength(1)
  staffId!: string;
}

export class WorkloadQueryDto {
  @IsOptional() @IsString()
  staffId?: string;
}

export class AvailableStaffQueryDto {
  @IsEnum(VisaCaseRoleSlotDto)
  roleSlot!: VisaCaseRoleSlotDto;
}
