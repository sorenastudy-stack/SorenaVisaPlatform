import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Query params for GET /admin/audit (the paginated list). All optional.
// Keyset pagination: pass back the previous page's `nextCursor.createdAt` +
// `nextCursor.id` as cursorCreatedAt/cursorId. Global ValidationPipe is
// forbidNonWhitelisted, so every accepted param must be declared here.
export class AuditQueryDto {
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  // Matched against BOTH eventType and the legacy `action` string.
  @IsOptional()
  @IsString()
  eventType?: string;

  // ISO timestamps (e.g. 2026-07-01T00:00:00.000Z). Parsed in the service.
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // Keyset cursor (from the prior page's nextCursor).
  @IsOptional()
  @IsString()
  cursorCreatedAt?: string;

  @IsOptional()
  @IsString()
  cursorId?: string;
}
