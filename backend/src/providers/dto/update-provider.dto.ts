import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';
import { CommissionType, ProviderStatus, ProviderType } from '@prisma/client';

export class UpdateProviderDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(ProviderType)
  @IsOptional()
  providerType?: ProviderType;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsUrl()
  @IsOptional()
  websiteUrl?: string;

  // PR-CATALOG-2 — the programme-listing/index page the monthly discovery crawl starts from.
  @IsUrl()
  @IsOptional()
  catalogueUrl?: string;

  // PR-SLOTRULES (Decision 2) — Owner "Featured" pin (additive Step-1 display only).
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @IsEnum(CommissionType)
  @IsOptional()
  commissionY1Type?: CommissionType;

  @IsNumber()
  @IsOptional()
  commissionY1Value?: number;

  @IsEnum(CommissionType)
  @IsOptional()
  commissionY2Type?: CommissionType;

  @IsNumber()
  @IsOptional()
  commissionY2Value?: number;

  @IsNumber()
  @IsOptional()
  volumeTarget?: number;

  @IsEnum(CommissionType)
  @IsOptional()
  bonusType?: CommissionType;

  @IsNumber()
  @IsOptional()
  bonusValue?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;
}
