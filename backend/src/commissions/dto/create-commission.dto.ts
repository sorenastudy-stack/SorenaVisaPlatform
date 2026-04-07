import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { CommissionType } from '@prisma/client';

export class CreateCommissionDto {
  @IsString()
  @IsNotEmpty()
  applicationId: string;

  @IsString()
  @IsNotEmpty()
  providerId: string;

  @IsString()
  @IsNotEmpty()
  programmeId: string;

  @IsNumber()
  @IsOptional()
  commissionYear?: number;

  @IsEnum(CommissionType)
  @IsOptional()
  commissionType?: CommissionType;

  @IsNumber()
  commissionValue: number;

  @IsNumber()
  @IsOptional()
  estimatedAmountNZD?: number;
}
