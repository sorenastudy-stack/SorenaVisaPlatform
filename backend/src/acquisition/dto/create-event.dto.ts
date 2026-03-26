import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  visitorId?: string;

  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  eventType: string;

  @IsOptional()
  @IsObject()
  eventData?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
  page?: string;
}
