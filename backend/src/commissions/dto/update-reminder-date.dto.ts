import { IsDateString } from 'class-validator';

export class UpdateReminderDateDto {
  @IsDateString()
  renewalReminderDate: string;
}
