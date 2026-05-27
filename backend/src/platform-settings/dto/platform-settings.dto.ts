import { IsString, MaxLength, MinLength } from 'class-validator';

// PR-SCORECARD-4 — DTOs for the platform-settings controller.
//
// The service does the URL-format check + per-key validation; this
// is just a minimum length/type guard at the controller boundary.

export class UpdateSettingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  value!: string;
}
