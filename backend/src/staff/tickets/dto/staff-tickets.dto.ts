import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// PR-SUPPORT-1 — DTOs for the staff tickets controller.
//
// The service does the deeper enum-membership + ownership checks;
// these are the request-shape guards at the controller boundary.

export class AddStaffMessageDto {
  // Rich-text HTML from the shared editor. Sanitized server-side before storage,
  // so a generous max (markup overhead) and min 0 (an attachment-only message is
  // allowed; the service rejects a message that is empty AND has no attachment).
  @IsString()
  @MaxLength(50_000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;

  // Attachment metadata from POST /staff/tickets/:id/attachments. The service
  // re-validates each entry (key belongs to this ticket, mime + size allowed).
  @IsOptional()
  @IsArray()
  attachments?: unknown[];
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
