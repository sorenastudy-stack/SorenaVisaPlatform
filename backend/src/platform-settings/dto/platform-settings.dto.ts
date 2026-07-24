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

// PR-ACCESS-GATE (Phase C) — the five company bank-transfer fields, edited as a
// single block from the admin form.
export class UpdateBankDetailsDto {
  @IsString() @MinLength(1) @MaxLength(2000) bankName!: string;
  @IsString() @MinLength(1) @MaxLength(2000) bankAddress!: string;
  @IsString() @MinLength(1) @MaxLength(2000) accountName!: string;
  @IsString() @MinLength(1) @MaxLength(2000) accountNumber!: string;
  @IsString() @MinLength(1) @MaxLength(2000) swift!: string;
}
