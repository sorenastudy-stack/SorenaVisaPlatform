import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CaseStage } from '@prisma/client';

export class CaseListQueryDto {
  @IsEnum(CaseStage)
  @IsOptional()
  stage?: CaseStage;

  @IsString()
  @IsOptional()
  ownerId?: string;
}
