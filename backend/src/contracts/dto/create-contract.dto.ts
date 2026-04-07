import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateContractDto {
  @IsString()
  @IsNotEmpty()
  caseId: string;

  @IsString()
  @IsOptional()
  templateId?: string;
}
