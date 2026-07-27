import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CommissionType, QualificationLevel } from '@prisma/client';

// A scholarship Sorena offers for a provider, scoped by applicant nationality and
// (optionally) a specific programme or qualification level.
export class CreateScholarshipDto {
  // ISO country code of the applicant nationality this scholarship applies to.
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  nationality: string;

  @IsString()
  @IsOptional()
  programmeId?: string;

  @IsEnum(QualificationLevel)
  @IsOptional()
  level?: QualificationLevel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEnum(CommissionType)
  @IsOptional()
  amountType?: CommissionType;

  @IsNumber()
  amountValue: number;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  currency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  eligibilityNotes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
