import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CommissionType, QualificationLevel } from '@prisma/client';

// Every field optional — a PATCH may touch any subset.
export class UpdateScholarshipDto {
  @IsString()
  @IsOptional()
  @MaxLength(3)
  nationality?: string;

  @IsString()
  @IsOptional()
  programmeId?: string;

  @IsEnum(QualificationLevel)
  @IsOptional()
  level?: QualificationLevel;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsEnum(CommissionType)
  @IsOptional()
  amountType?: CommissionType;

  @IsNumber()
  @IsOptional()
  amountValue?: number;

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
