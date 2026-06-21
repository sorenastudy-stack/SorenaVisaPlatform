import { IsDateString, IsOptional } from 'class-validator';

// Body DTO for POST /digest/case/:caseId/send.
//
// Both fields optional. When BOTH omitted, the controller defaults to
// the last 7 days (until = now, since = now - 7d) so the manual trigger
// behaves like the future Friday cron. When provided, ISO format is
// required and the controller checks since < until — a richer
// cross-field check than class-validator does cleanly inline.

export class SendDigestDto {
  @IsOptional()
  @IsDateString({}, { message: 'since must be an ISO date string' })
  since?: string;

  @IsOptional()
  @IsDateString({}, { message: 'until must be an ISO date string' })
  until?: string;
}
