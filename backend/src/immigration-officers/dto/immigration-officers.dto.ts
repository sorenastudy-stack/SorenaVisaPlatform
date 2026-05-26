import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// PR-LIA-10 — DTOs for the Immigration Officer module.
//
// Note: officer creation deliberately doesn't enforce uniqueness on
// (fullName, branch) — duplicates are recoverable, hard-blocking creates
// friction. The service returns a "looks-like-existing" hint instead.

export class CreateOfficerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  officerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryOfPosting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  profileDescription?: string;
}

export class UpdateOfficerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  officerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryOfPosting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  profileDescription?: string;
}

export class AddObservationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];
}

export class ListOfficersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryOfPosting?: string;

  @IsOptional()
  @IsString()
  sort?: 'mostRecent' | 'mostActive' | 'name';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class LinkOfficerDto {
  @IsString()
  @MinLength(1)
  officerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
