import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateLeadDto {
  @IsNotEmpty()
  @IsString()
  contactId: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}
