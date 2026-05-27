import {
  IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import {
  AffiliateAgentStatus, MarketingChannelType, TrackingLinkStatus,
} from '@prisma/client';

// PR-SCORECARD-2 — Marketing DTOs.
//
// Two domains: AffiliateAgent CRUD + TrackingLink CRUD. Filters are
// loose query DTOs because the only consumer is the staff portal —
// the role gate at the controller stops anyone else even reaching here.

// ─── AffiliateAgent ────────────────────────────────────────────────

export class CreateAffiliateAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAffiliateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ChangeAgentStatusDto {
  @IsEnum(AffiliateAgentStatus)
  status!: AffiliateAgentStatus;
}

// ─── TrackingLink ──────────────────────────────────────────────────

export class CreateTrackingLinkDto {
  @IsEnum(MarketingChannelType)
  channel!: MarketingChannelType;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  campaignLabel?: string;

  // Destination defaults to /scorecard/landing in the service if absent.
  // Allowed to be empty so the staff UI can submit with just a channel.
  @IsOptional()
  @IsString()
  destination?: string;
}

export class ArchiveTrackingLinkDto {
  // Empty body — id is in the path. Kept as a class so the controller
  // can declare a typed param for forward-compat.
  @IsOptional()
  @IsString()
  _unused?: string;
}

export class TrackingLinkStatsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  windowDays?: number;
}

// Re-export the Prisma enums so the controller can use them as type
// hints in query handlers without a second import line.
export { AffiliateAgentStatus, MarketingChannelType, TrackingLinkStatus };
