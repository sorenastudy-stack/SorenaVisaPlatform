import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { CommissionType } from '@prisma/client';

export class CreateCommissionDto {
  // PR-COMMISSION-ANCHOR — the AdmissionProgrammeChoice this commission is
  // earned on. Was `applicationId`; `Application` is not part of the admission
  // flow and never held a row.
  @IsString()
  @IsNotEmpty()
  programmeChoiceId: string;

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
