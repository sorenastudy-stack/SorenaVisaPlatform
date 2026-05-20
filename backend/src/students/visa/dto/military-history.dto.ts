// PR-VISA10 — Step 10 (Military service) request DTO.
//
// The global ValidationPipe (configured in main.ts) runs these
// decorators automatically. Cross-field rules — "explanation required
// when D3 = true", "≥1 entry required when D2 = true", "no entries
// when D2 = false" — live in visa.service.saveMilitaryHistory rather
// than DTO-level @ValidateIf chains, because the service-level errors
// produce cleaner field-by-field messages and the smoke test wants
// specific message text on each failure mode.
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MilitaryServiceEntryDto {
  @IsISO8601()
  dateStarted!: string;

  @IsISO8601()
  dateFinished!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  location!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  corps!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  division!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  brigade!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  battalion!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  unit!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  rank!: string;

  // Free-text role description — encrypted at the service layer.
  @IsString() @MinLength(1) @MaxLength(5000)
  duties!: string;

  @IsString() @MinLength(1) @MaxLength(500)
  commandingOfficer!: string;
}

export class MilitaryHistoryDto {
  @IsBoolean()
  militaryServiceCompulsoryHome!: boolean;

  @IsBoolean()
  everUndertakenMilitaryService!: boolean;

  @IsBoolean()
  wasExemptFromMilitaryService!: boolean;

  // Required iff wasExemptFromMilitaryService === true. The DTO layer
  // only enforces the type + length cap; the "required + min 20 chars
  // when D3 = true" rule is enforced in the service so the error
  // message can name the specific field.
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  exemptExplanation?: string | null;

  // Required iff everUndertakenMilitaryService === true. The "at least
  // one when D2 = true" rule lives in the service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MilitaryServiceEntryDto)
  militaryServices?: MilitaryServiceEntryDto[];
}
