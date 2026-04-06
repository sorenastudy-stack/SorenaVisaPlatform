import { IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateOrUpdateIntakeDto {
  @IsOptional()
  @IsString()
  highestQualification?: string;

  @IsOptional()
  @IsString()
  fieldOfStudy?: string;

  @IsOptional()
  @IsNumber()
  gpa?: number;

  @IsOptional()
  @IsString()
  englishTestType?: string;

  @IsOptional()
  @IsNumber()
  englishOverallScore?: number;

  @IsOptional()
  englishComponentScores?: Record<string, number>;

  @IsOptional()
  @IsString()
  financialLevel?: string;

  @IsOptional()
  @IsNumber()
  estimatedBudgetNZD?: number;

  @IsOptional()
  @IsString()
  visaHistory?: string;

  @IsOptional()
  @IsNumber()
  visaRejectionCount?: number;

  @IsOptional()
  @IsString()
  visaRejectionReason?: string;

  @IsOptional()
  @IsNumber()
  workExperienceYears?: number;

  @IsOptional()
  @IsString()
  studyIntent?: string;

  @IsOptional()
  preferredStartDate?: Date;

  @IsOptional()
  @IsString()
  preferredLevel?: string;

  @IsOptional()
  @IsString()
  preferredField?: string;
}
