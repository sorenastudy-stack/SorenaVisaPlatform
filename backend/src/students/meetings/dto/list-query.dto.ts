// PR-DASH-3 — Shared list-query DTO.
//
// Student + consultant list endpoints take the same filter params.
// status accepts a comma-separated list (e.g. ?status=SCHEDULED,COMPLETED).
// from/to are ISO date strings.
import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

export class ListMeetingsQueryDto {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsISO8601()
  from?: string;

  @IsOptional() @IsISO8601()
  to?: string;

  // Consultant-only: filter by studentId. Validated as a cuid-shape
  // string (User.id default(cuid)).
  @IsOptional() @IsString()
  @Matches(/^[a-z0-9]+$/, { message: 'studentId must be a cuid' })
  studentId?: string;

  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  pageSize?: string;
}
