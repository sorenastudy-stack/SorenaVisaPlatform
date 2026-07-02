import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

// PR-CONSULT-2 — Staff cases query DTO.
//
// Each filter is optional. The `status` param filters the CaseStage column
// (Case.status is vestigial), so it's validated against CaseStage values —
// NOT VisaCaseStatus. `assignedToMe` / `activeOnly` / `q` are free-form.
// `page` / `pageSize` carry sensible defaults + a hard upper bound.

const CASE_STAGES = [
  'ADMISSION',
  'VISA',
  'INZ_SUBMITTED',
  'COMPLETED',
  'WITHDRAWN',
] as const;

export class StaffCasesListQueryDto {
  @IsOptional()
  @IsIn(CASE_STAGES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsBooleanString()
  assignedToMe?: string;

  // PR-OPS-CASES: when 'true', restrict to active cases
  // (stage NOT IN COMPLETED/WITHDRAWN). Used by the OPS cases page.
  @IsOptional()
  @IsBooleanString()
  activeOnly?: string;

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
