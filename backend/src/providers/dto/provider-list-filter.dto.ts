import { IsEnum, IsOptional } from 'class-validator';
import { ProviderStatus, ProviderType } from '@prisma/client';

export class ProviderListQueryDto {
  @IsEnum(ProviderType)
  @IsOptional()
  providerType?: ProviderType;

  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;
}
