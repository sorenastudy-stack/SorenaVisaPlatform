import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCaseDto {
  @IsString()
  @IsNotEmpty()
  leadId: string;
}
