import { IsEnum } from 'class-validator';
import { CommissionStatus } from '@prisma/client';

export class UpdateCommissionStatusDto {
  @IsEnum(CommissionStatus)
  status: CommissionStatus;
}
