import { IsObject, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// PR-SCORECARD-1 — DTOs.
//
// The submit payload is intentionally loose: a Record<string,string>
// of questionnaire answers. The engine handles missing fields and
// unknown options gracefully (zero points). Validating per-field
// against the SCORES table at DTO level would duplicate the engine's
// own logic and create drift risk.
//
// PR-SCORECARD-2 — `attribution` carries marketing/affiliate context
// pulled by the client from the sv_attribution cookie and/or the
// ?ch=X&agent=Y&campaign=Z URL parameters. All three fields are
// optional — direct traffic submits with an empty attribution object.

export class AttributionDto {
  @IsOptional()
  @IsString()
  trackingLinkId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  campaignLabel?: string;

  // Channel hint from ?ch=...; used as a fallback when trackingLinkId
  // is absent but the user came from a URL with the channel encoded.
  @IsOptional()
  @IsString()
  channel?: string;
}

export class SubmitScorecardDto {
  @IsObject()
  answers!: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttributionDto)
  attribution?: AttributionDto;

  // Destination country the visitor picked on /start ('NEW_ZEALAND' |
  // 'MALAYSIA'). Client-supplied → untrusted. Deliberately NOT type-validated
  // here (no @IsString) so NO value can ever 400 the submit; the service is the
  // single gate — it whitelists to the enum or persists null. A wrong string,
  // a non-string, or a missing value all just become null.
  @IsOptional()
  targetCountry?: string;
}

// PR-SCORECARD-2 — autosave payload. Same shape as submit but
// the controller routes it to saveDraft() — answers may be partial,
// scoring is NOT run, no Lead is created.
export class SaveScorecardDraftDto {
  @IsObject()
  answers!: Record<string, string>;
}

export class RecordBookingOpenedDto {
  // Empty body — the submission id is in the path. Kept as a class
  // so the controller has a typed body parameter (forward-compat for
  // adding metadata like booking-link variant tracking later).
  @IsString()
  @MinLength(0)
  _unused?: string = '';
}
