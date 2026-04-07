import { IsDateString, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateAgreementDto {
  @IsUrl()
  @IsOptional()
  agreementUrl?: string;

  @IsDateString()
  @IsOptional()
  agreementStartDate?: string;

  @IsDateString()
  @IsOptional()
  agreementEndDate?: string;

  @IsDateString()
  @IsOptional()
  agreementRenewalDate?: string;
}
