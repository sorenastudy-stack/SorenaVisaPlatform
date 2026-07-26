import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { VisaTicketDepartment } from '@prisma/client';

export class CreateStaffTicketDto {
  @IsString()
  contactId!: string;

  @IsOptional()
  @IsString()
  caseId?: string;

  @IsEnum(VisaTicketDepartment)
  department!: VisaTicketDepartment;

  @IsString()
  @MaxLength(200)
  subject!: string;
}
