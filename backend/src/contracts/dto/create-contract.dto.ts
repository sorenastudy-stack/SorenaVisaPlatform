import { IsOptional, IsString } from 'class-validator';

// PR-CONTRACT-LEAD (Phase B) — a send targets EITHER an existing case (caseId, the
// legacy path) OR a lead with no case yet (leadId, the lead-based path). Exactly
// one must be provided; the service enforces that (a DTO can't cleanly express
// "exactly one of"). Both optional here so either shape validates.
export class CreateContractDto {
  @IsString()
  @IsOptional()
  caseId?: string;

  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  @IsOptional()
  templateId?: string;
}
