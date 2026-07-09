import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
// Phase 2b — validate preferredLanguage as a lowercase ISO 639-1 code (shared
// with the staff-languages DTO) so intake can't store display names like
// "English"/"Farsi". Keeps client language comparable to staff User.languages.
import { IsLanguageCode } from '../../common/validators/is-language-code.decorator';

// PR-AUDIT-4 — typed body for POST /public/intake. Validates the
// known field shape (length-caps + type checks) so an unauth caller
// can't blast oversized strings or junk types into the DB. The
// controller applies this DTO with a route-level ValidationPipe
// whose `forbidNonWhitelisted` is FALSE — global config is true,
// but this is a lead-capture endpoint and Wix forms / marketing
// pages may send extra UTM/envelope fields we don't enumerate.
// Rejecting a real lead is worse than letting harmless unknown
// fields through. Service still only reads the fields it knows
// about; everything else is silently dropped past validation.

export class SubmitIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  preferredLevel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  // Phase 2b: must be a lowercase ISO 639-1 code (e.g. 'en', 'fa') — display
  // names are rejected. Optional; absent → the service defaults to 'en'.
  @IsOptional()
  @IsLanguageCode()
  preferredLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  highestQualification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fieldOfStudy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  englishTestType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  englishOverallScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  financialLevel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000000)
  estimatedBudgetNZD?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  visaRejectionCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  studyIntent?: string;

  // Kept as string — the service stores this verbatim in
  // intake_forms.preferredStartDate (a String column) and parses
  // to Date only for scoring. Switching to @IsDateString would
  // reject legitimate values like '2026-07' that today's callers
  // send.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  preferredStartDate?: string;

  // Throw-through fields below — known to be sent by existing
  // callers (the eligibility-page generator, the e2e smoke test)
  // but NOT consumed by submitIntakeForm. Whitelisted so they
  // don't 400 and so we keep the route's loose-field contract
  // explicit instead of relying on forbidNonWhitelisted:false
  // alone to catch them.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  englishTestSpecify?: string;

  @IsOptional()
  @IsNumber()
  gpa?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredField?: string;

  @IsOptional()
  englishComponentScores?: Record<string, number>;
}
