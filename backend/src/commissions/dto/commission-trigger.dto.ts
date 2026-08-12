import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CommissionType } from '@prisma/client';

// PR-COMMISSION-TRIGGER — messages are written for the person on the screen,
// not quoted from the validator (see the exchange-rate fix earlier today).

export class ConfirmAttendanceDto {
  /** Defaults to now when omitted — the common case is confirming on the day. */
  @IsOptional() @IsString()
  attendedAt?: string;
}

export class ApproveTriggerDto {
  @IsOptional() @IsEnum(CommissionType, { message: 'Commission type must be PERCENTAGE or FIXED.' })
  commissionType?: CommissionType;

  @IsNumber({}, { message: 'Enter the commission rate or amount.' })
  @Min(0.01, { message: 'The commission value must be greater than zero.' })
  commissionValue!: number;

  @IsOptional() @IsNumber({}, { message: 'Commission year must be a number.' })
  commissionYear?: number;

  @IsOptional() @IsNumber({}, { message: 'The estimated amount must be a number.' })
  estimatedAmountNZD?: number;
}

export class RejectTriggerDto {
  @IsString() @IsNotEmpty({ message: 'Give a reason so the Admission Officer knows what to fix.' })
  @MaxLength(2000)
  reason!: string;
}
