import { IsOptional, IsString, MaxLength, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateVisitorDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => value?.trim())
  fingerprint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @IsIn(['NZ'])
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmCampaign?: string;
}
