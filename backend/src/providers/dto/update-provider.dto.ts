import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';
import { CommissionType, InstitutionType, ProviderStatus, ProviderType } from '@prisma/client';

export class UpdateProviderDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(ProviderType)
  @IsOptional()
  providerType?: ProviderType;

  // PR-ENGLISH-COMMISSION — the English-language-course rate for this
  // institution. Nullable end to end: omit to leave it unset, send null to
  // clear it back to "no separate English rate". A cleared rate is NOT zero —
  // it means the normal rate applies again.
  @IsEnum(CommissionType)
  @IsOptional()
  commissionEnglishY1Type?: CommissionType | null;

  @IsNumber()
  @IsOptional()
  commissionEnglishY1Value?: number | null;

  @IsEnum(CommissionType)
  @IsOptional()
  commissionEnglishY2Type?: CommissionType | null;

  @IsNumber()
  @IsOptional()
  commissionEnglishY2Value?: number | null;

  // PR-RECS-PHASE0 — University / ITP / PTE.
  //
  // This had NO write path anywhere in the app: not in this DTO, not in any
  // screen. It was only ever set by the CLI bulk import, from which source file
  // an institution arrived in — which is why production holds 0 UNIVERSITY,
  // 1 ITP, 72 PTE and 23 unset, with no way to correct any of it.
  //
  // It is not cosmetic: the institution-type slot rule in Apply/Study keys on it,
  // and cannot safely be switched on until it is right.
  @IsEnum(InstitutionType)
  @IsOptional()
  institutionType?: InstitutionType;

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
