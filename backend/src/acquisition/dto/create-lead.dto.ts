import {
  IsString,
  IsEmail,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  MaxLength,
  MinLength,
  IsIn,
  Equals,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty({ message: 'Full name is required.' })
  @MinLength(2, { message: 'Full name must be at least 2 characters.' })
  @MaxLength(100, { message: 'Full name is too long.' })
  @Transform(({ value }) => value?.trim())
  fullName: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @MaxLength(254)
  @Transform(({ value }) => value?.trim().toLowerCase() || undefined)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => value?.replace(/[\s\-\(\)]/g, '').trim() || undefined)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => value?.replace(/[\s\-\(\)]/g, '').trim() || undefined)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @IsIn(['NZ'], { message: 'Only NZ destination is currently supported.' })
  destination?: string;

  @IsOptional()
  @IsString()
  @IsIn(['secondary', 'undergraduate', 'postgraduate', 'vocational', 'phd', 'other'])
  studyLevel?: string;

  @IsOptional()
  @IsString()
  @IsIn(['English', 'Persian', 'Mandarin', 'Arabic', 'Hindi', 'Other'])
  preferredLanguage?: string;

  @IsBoolean({ message: 'Privacy consent must be a boolean.' })
  @Equals(true, { message: 'Privacy consent is required.' })
  privacyConsent: boolean;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  visitorId?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  landingPage?: string;

  // Honeypot — must be empty. Bots fill this in automatically.
  @IsOptional()
  @IsString()
  @MaxLength(0, { message: 'Submission rejected.' })
  website?: string;
}
