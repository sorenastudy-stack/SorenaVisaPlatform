import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// PR-AGENT-PORTAL-2 — the per-agent commission rate.
//
// Its own DTO and its own endpoint rather than a field on UpdateAffiliateAgentDto,
// because it is not the same kind of change. Name and phone are administrative;
// this decides what somebody is paid. It carries a tighter role (OWNER, checked
// server-side), bounds validation, and its own audit event recording old → new.
export class SetAgentRateDto {
  /**
   * Percent, 0–100. NULL is meaningful and allowed: it clears the per-agent rate
   * so the agent falls back to the company default (AGENT_COMMISSION_RATE_PERCENT).
   * That is not the same as 0, which would mean an agreed rate of nothing.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Rate must be a number with at most 2 decimal places.' })
  @Min(0, { message: 'Rate cannot be negative.' })
  @Max(100, { message: 'Rate cannot be more than 100%.' })
  ratePercent?: number | null;
}
