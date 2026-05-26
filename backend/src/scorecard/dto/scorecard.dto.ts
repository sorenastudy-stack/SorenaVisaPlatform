import { IsObject, IsString, MinLength } from 'class-validator';

// PR-SCORECARD-1 — DTOs.
//
// The submit payload is intentionally loose: a Record<string,string>
// of questionnaire answers. The engine handles missing fields and
// unknown options gracefully (zero points). Validating per-field
// against the SCORES table at DTO level would duplicate the engine's
// own logic and create drift risk.

export class SubmitScorecardDto {
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
