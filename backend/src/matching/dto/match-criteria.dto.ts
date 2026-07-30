import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

const LEVELS = [
  'CERTIFICATE', 'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
  'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD',
];

// PR-PHASE32 — Step-1 assessment answers → match input. (When the redesigned
// questionnaire ships, the frontend derives this from the submission; the
// endpoint also accepts it directly.)
export class MatchCriteriaDto {
  @IsOptional() @IsString()
  qualificationFieldId!: string | null; // Q13 → StudyField id (null = Other)

  @IsArray() @IsString({ each: true })
  preferredFieldIds: string[] = [];      // Q32

  @IsArray() @IsIn(LEVELS, { each: true })
  desiredLevels: string[] = [];          // Q33

  @IsOptional() @IsIn(LEVELS)
  currentHighestLevel!: string | null;   // Q12

  @IsOptional() @IsNumber()
  gpaBand?: number;                      // Q14

  @IsOptional() @IsNumber()
  ieltsEquivalent?: number;              // Q16

  @IsOptional() @IsInt()
  tuitionBudgetNZD?: number;             // Q34

  @IsOptional() @IsString()
  nationality?: string;                  // Q5 (ISO)

  @IsOptional() @IsArray() @IsString({ each: true })
  locationPref?: string[];               // Q35

  @IsOptional() @IsBoolean()
  workWhileStudying?: boolean;           // Q36
}
