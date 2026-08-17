import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsNumber, IsOptional, IsString,
  Max, MaxLength, Min,
} from 'class-validator';

// PR-PROVIDER-PORTAL slice E — groups, and the rates attached to them.
//
// A GROUP CARRIES NO MONEY, so it has no review gate: it is a name and a list of
// country codes. The RATE attached to a group is a ProviderTuition or
// ProviderScholarship row and is gated exactly like every other rate. Reviewing
// "these twenty countries are called South Asia" would be reviewing a label.
//
// `providerId` appears in none of these. It comes from the guard.

export class UpsertNationalityGroupDto {
  @IsString() @MaxLength(80)
  name!: string;

  /**
   * ISO 3166-1 alpha-2 codes. Upper-cased and de-duplicated in the service so
   * "ir" and "IR" cannot both sit in one group and make membership depend on
   * which one a comparison happens to hit first.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'A group needs at least one country.' })
  @ArrayMaxSize(250)
  @IsString({ each: true })
  @MaxLength(2, { each: true, message: 'Countries must be two-letter codes.' })
  nationalities!: string[];

  /**
   * The institution-wide DEFAULT for this group — a rate that applies to every
   * programme unless that programme has its own override.
   *
   * Optional in three ways on purpose: absent, present-with-a-number, and
   * explicitly `null`. Absent means "leave whatever is there alone"; null means
   * "clear it", which deactivates the row rather than deleting it.
   */
  @IsOptional()
  @IsNumber({}, { message: 'Tuition must be an amount in NZD.' })
  @Min(0) @Max(1_000_000)
  @Type(() => Number)
  defaultTuitionAmount?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'Scholarship must be an amount in NZD.' })
  @Min(0) @Max(1_000_000)
  @Type(() => Number)
  defaultScholarshipAmount?: number | null;
}

/**
 * A rate for a group — tuition.
 *
 * Deliberately NOT accepting `nationality`: this endpoint exists to attach a rate
 * to a GROUP, and a single-nationality rate goes through the existing path. One
 * DTO that accepted either would need to enforce the XOR itself, and would be the
 * obvious place for a future edit to accidentally allow both.
 */
export class CreateGroupTuitionDto {
  @IsString()
  nationalityGroupId!: string;

  @IsNumber() @Min(0) @Max(1_000_000) @Type(() => Number)
  amountValue!: number;

  @IsOptional() @IsIn(['NZD'], { message: 'Rates must be in NZD.' })
  currency?: string;

  @IsOptional() @IsString() @MaxLength(120)
  programmeId?: string;

  @IsOptional()
  @IsEnum(
    ['CERTIFICATE', 'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
     'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD'],
    { message: 'Study level is not one we recognise.' },
  )
  level?: string;

  @IsOptional() @IsNumber() @Min(2020) @Max(2100) @Type(() => Number)
  feeYear?: number;

  @IsOptional() @IsString() @MaxLength(80)
  term?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

/** A rate for a group — scholarship. */
export class CreateGroupScholarshipDto {
  @IsString()
  nationalityGroupId!: string;

  @IsString() @MaxLength(200)
  name!: string;

  @IsOptional() @IsIn(['FIXED', 'PERCENTAGE'])
  amountType?: string;

  @IsNumber() @Min(0) @Max(1_000_000) @Type(() => Number)
  amountValue!: number;

  @IsOptional() @IsIn(['NZD'], { message: 'Awards must be in NZD.' })
  currency?: string;

  @IsOptional() @IsString() @MaxLength(120)
  programmeId?: string;

  @IsOptional()
  @IsEnum(
    ['CERTIFICATE', 'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
     'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD'],
    { message: 'Study level is not one we recognise.' },
  )
  level?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  eligibilityNotes?: string;
}
