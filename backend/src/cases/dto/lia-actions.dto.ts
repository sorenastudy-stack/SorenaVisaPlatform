import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { RiskLevel } from '@prisma/client';

// PR-LIA-1 — DTOs for the two LIA-only endpoints added to
// CasesController: PATCH /cases/:id/risk and PATCH /cases/:id/clear-hard-stop.

export class OverrideRiskDto {
  @IsEnum(RiskLevel)
  riskLevel!: RiskLevel;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  reason!: string;
}

export class ClearHardStopDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  reason!: string;
}
