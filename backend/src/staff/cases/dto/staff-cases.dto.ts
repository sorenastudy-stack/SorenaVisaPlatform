import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

// PR-CONSULT-2 — Staff cases query DTO.
//
// Each filter is optional. `status` is validated against the known
// VisaCaseStatus enum values. `assignedToMe` and `q` are free-form.
// `page` / `pageSize` carry sensible defaults + a hard upper bound.

const VISA_CASE_STATUSES = [
  'DRAFT',
  'SUBMITTED_FOR_REVIEW',
  'REVIEWED',
  'READY_FOR_INZ',
  'INZ_SUBMITTED',
  'APPROVED',
  'DECLINED',
] as const;

export class StaffCasesListQueryDto {
  @IsOptional()
  @IsIn(VISA_CASE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsBooleanString()
  assignedToMe?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
