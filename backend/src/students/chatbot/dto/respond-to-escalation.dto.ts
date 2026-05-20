// PR-DASH-4 — POST escalate DTO.
//
// `accept: true`  → create a real VisaSupportTicket and link it back
//                   to the originating assistant message.
// `accept: false` → audit-log the decline; no ticket created.
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class RespondToEscalationDto {
  @IsBoolean()
  accept!: boolean;

  // Optional context the student wants to add to the ticket
  // (e.g. their preferred contact time). Appended to the ticket
  // body after the chat-message replay.
  @IsOptional() @IsString() @MaxLength(2000)
  additionalContext?: string;
}
