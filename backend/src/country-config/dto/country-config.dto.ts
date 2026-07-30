import {
  IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min,
} from 'class-validator';

// PR-OWNER-1 (slice a) — DTOs for the Owner-editable per-country config.
//
// Boundary guard only (type/range). Deep structural validation of the JSON
// shapes (slotRules positions, weighting keys) lives in the service, mirroring
// how SlaService/PlatformSettingsService do their domain checks server-side.

export const INSTITUTION_TYPES = ['UNIVERSITY', 'ITP', 'PTE'] as const;
export const GUIDANCE_LEVELS = ['STRICT', 'MODERATE', 'LOW'] as const;

// PATCH execution — every field optional (partial update).
export class UpdateExecutionConfigDto {
  @IsOptional() @IsInt() @Min(1) @Max(20)
  slotCount?: number;

  // [{ position:int, allowedTypes:InstitutionType[], mandatory:bool, preferred?:InstitutionType }]
  @IsOptional() @IsArray()
  slotRules?: unknown[];

  // { UNIVERSITY:number, ITP:number, PTE:number } — any subset; each 0..1.
  @IsOptional() @IsObject()
  institutionTypeWeighting?: Record<string, unknown>;
}

// PATCH country-level AI config.
export class UpdateAIConfigDto {
  @IsOptional() @IsIn(GUIDANCE_LEVELS)
  guidanceLevel?: (typeof GUIDANCE_LEVELS)[number];

  @IsOptional() @IsBoolean()
  sopGateEnforcement?: boolean;

  @IsOptional() @IsString()
  activePromptVersionId?: string | null;
}

// PATCH per-agent config.
export class UpdateAgentConfigDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  maxOptionsShown?: number | null;

  @IsOptional() @IsString()
  promptVersionId?: string | null;

  @IsOptional() @IsObject()
  settingsJson?: Record<string, unknown> | null;
}
