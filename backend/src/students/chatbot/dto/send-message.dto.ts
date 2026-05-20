// PR-DASH-4 — POST /api/student/chatbot/conversations/:id/messages DTO.
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  content!: string;

  // Optional client-supplied locale so the system prompt can route
  // the assistant's reply to the right language. The frontend reads
  // the user's locale store; we don't trust it for anything other
  // than tone — defaults to 'en' if missing or unrecognised.
  @IsOptional() @IsIn(['en', 'fa'])
  locale?: 'en' | 'fa';
}
