// PR-DASH-4 — GET /api/student/chatbot/conversations query DTO.
//
// Simple pagination — the student-side chat doesn't need anything
// fancier. We default to 20 rows per page; the controller clamps to
// [1, 50] so a hand-rolled curl can't drag the whole conversation
// history into one response.
import { IsOptional, IsString, Matches } from 'class-validator';

export class ListConversationsDto {
  @IsOptional() @IsString() @Matches(/^[0-9]+$/)
  page?: string;

  @IsOptional() @IsString() @Matches(/^[0-9]+$/)
  pageSize?: string;
}
