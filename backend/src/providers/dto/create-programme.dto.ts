import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { NZQFLevel, QualificationLevel } from '@prisma/client';

export class CreateProgrammeDto {
  @IsString()
  @IsOptional()
  facultyId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(QualificationLevel)
  level: QualificationLevel;

  @IsEnum(NZQFLevel)
  nzqfLevel: NZQFLevel;

  @IsNumber()
  @IsOptional()
  durationMonths?: number;

  @IsNumber()
  @IsOptional()
  tuitionFeeNZD?: number;

  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  intakeMonths: number[];
}
