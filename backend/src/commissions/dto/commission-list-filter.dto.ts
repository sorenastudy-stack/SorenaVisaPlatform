import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CommissionStatus } from '@prisma/client';

export class CommissionListQueryDto {
  @IsEnum(CommissionStatus)
  @IsOptional()
  status?: CommissionStatus;

  @IsString()
  @IsOptional()
  providerId?: string;
}
