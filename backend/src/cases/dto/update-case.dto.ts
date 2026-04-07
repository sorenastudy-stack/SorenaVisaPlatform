import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CaseStage } from '@prisma/client';

export class UpdateCaseDto {
  @IsEnum(CaseStage)
  @IsOptional()
  stage?: CaseStage;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
