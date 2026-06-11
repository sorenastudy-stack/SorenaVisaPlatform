import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'to must be an E.164 phone number, e.g. +15551234567 (leading +, country code, no spaces or dashes)',
  })
  @MaxLength(20)
  to: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message: string;
}
