import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { CaseStage, ProviderType } from '@prisma/client';

export class UpdateSlaConfigDto {
  @IsEnum(ProviderType)
  institutionType!: ProviderType;

  @IsEnum(CaseStage)
  stage!: CaseStage;

  @IsInt()
  @Min(0)
  @Max(365)
  slaDays!: number;
}
