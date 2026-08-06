import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const EXPLORE_SORTS = ['featured', 'lowestTuition', 'highestScholarship', 'lowestNetCost'] as const;

export class ExploreQueryDto {
  @IsOptional() @IsIn(EXPLORE_SORTS as unknown as string[])
  sort?: (typeof EXPLORE_SORTS)[number];

  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @IsOptional() @IsString() @MaxLength(60)
  level?: string;

  // Query params arrive as strings; Type() coerces before validation.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000)
  maxTuitionNZD?: number;
}
