import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateLeadNotesDto {
  @IsNotEmpty()
  @IsString()
  managerNotes: string;
}
