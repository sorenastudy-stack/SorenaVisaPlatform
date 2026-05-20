// PR-DASH-2 — Support-ticket DTOs.
//
// The DTO layer enforces type + length caps + enum membership; the
// service layer handles all cross-field rules and ownership. Subject
// and message body trim happens in the service so a body of "   " is
// rejected with a clear "messageRequired" error rather than a misleading
// MinLength one.
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum VisaTicketDepartmentDto {
  ADMISSIONS         = 'ADMISSIONS',
  VISA_APPLICATION   = 'VISA_APPLICATION',
  DOCUMENTS          = 'DOCUMENTS',
  PAYMENTS_FINANCE   = 'PAYMENTS_FINANCE',
  TECHNICAL_SUPPORT  = 'TECHNICAL_SUPPORT',
  GENERAL_INQUIRY    = 'GENERAL_INQUIRY',
}

export enum VisaTicketStatusDto {
  OPEN         = 'OPEN',
  IN_PROGRESS  = 'IN_PROGRESS',
  RESOLVED     = 'RESOLVED',
  CLOSED       = 'CLOSED',
}

// POST /students/me/tickets
export class CreateTicketDto {
  @IsEnum(VisaTicketDepartmentDto)
  department!: VisaTicketDepartmentDto;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  initialMessage!: string;
}

// POST /students/me/tickets/:id/messages
export class CreateTicketMessageDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body!: string;
}

// GET /students/me/tickets query string — both filter params accept
// comma-separated values so the frontend can pass multi-select state
// as a flat URL.
export class ListTicketsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  department?: string;
}
