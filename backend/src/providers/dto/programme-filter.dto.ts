import { IsEnum, IsOptional } from 'class-validator';
import { QualificationLevel, ReviewStatus } from '@prisma/client';

export class ProgrammeListQueryDto {
  @IsEnum(QualificationLevel)
  @IsOptional()
  level?: QualificationLevel;

  @IsEnum(ReviewStatus)
  @IsOptional()
  reviewStatus?: ReviewStatus;
}
