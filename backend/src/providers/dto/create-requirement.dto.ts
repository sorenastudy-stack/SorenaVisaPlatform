import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateRequirementDto {
  @IsString()
  @IsOptional()
  minQualificationLevel?: string;

  @IsNumber()
  @IsOptional()
  minGpa?: number;

  @IsString()
  @IsOptional()
  englishTestType?: string;

  @IsNumber()
  @IsOptional()
  englishOverallMin?: number;

  @IsObject()
  @IsOptional()
  englishComponentMins?: Record<string, number>;

  @IsBoolean()
  @IsOptional()
  workExperienceRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  portfolioRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  interviewRequired?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documentsRequired?: string[];

  @IsString()
  @IsOptional()
  additionalNotes?: string;
}
