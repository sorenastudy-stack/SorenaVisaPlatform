import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// PR-SUPPORT-1 — DTOs for the staff tickets controller.
//
// The service does the deeper enum-membership + ownership checks;
// these are the request-shape guards at the controller boundary.

export class AddStaffMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;
}

const STATUS_VALUES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export class UpdateTicketStatusDto {
  @IsString()
  @IsIn(STATUS_VALUES as unknown as string[])
  status!: (typeof STATUS_VALUES)[number];
}

export class AssignTicketDto {
  // null unsets the assignment; string assigns to that user id.
  @IsOptional()
  assignedStaffId!: string | null;
}
