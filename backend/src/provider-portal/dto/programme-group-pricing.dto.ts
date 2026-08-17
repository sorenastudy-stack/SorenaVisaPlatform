import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

// PR-PROVIDER-PORTAL — per-programme pricing by country group.
//
// The client sends the DESIRED STATE for this programme: one entry per group it
// wants priced. A group that is absent from the list, or present with both
// amounts blank, means "no override here" — and the service deactivates any row
// that used to provide one.
//
// Sending the whole picture rather than individual add/remove calls is what
// makes unchecking expressible at all: there is no "delete this pricing" verb,
// because the portal does not hard-delete priced data.
//
// `nationality` appears nowhere. These rows are group-scoped by construction,
// and the database CHECK constraint would reject anything else.

export class ProgrammeGroupPriceEntryDto {
  @IsString()
  nationalityGroupId!: string;

  /** NZD. Null or omitted = no tuition override for this group on this programme. */
  @IsOptional()
  @IsNumber({}, { message: 'Tuition must be an amount in NZD.' })
  @Min(0) @Max(1_000_000)
  @Type(() => Number)
  tuitionAmount?: number | null;

  /** NZD. Null or omitted = no scholarship for this group on this programme. */
  @IsOptional()
  @IsNumber({}, { message: 'Scholarship must be an amount in NZD.' })
  @Min(0) @Max(1_000_000)
  @Type(() => Number)
  scholarshipAmount?: number | null;

  /**
   * Optional label. The form does not ask for one — the brief is two amount
   * fields — so the service names it after the group when this is absent. It is
   * accepted so an existing award's name survives an edit instead of being
   * silently renamed.
   */
  @IsOptional() @IsString() @MaxLength(200)
  scholarshipName?: string;
}

export class SetProgrammeGroupPricingDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProgrammeGroupPriceEntryDto)
  entries!: ProgrammeGroupPriceEntryDto[];
}
