import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// PR-LIA-4 — DTOs for the LIA-side and client-side messaging endpoints.

export enum LiaMessageKindDto {
  MESSAGE = 'MESSAGE',
  PROGRESS_UPDATE = 'PROGRESS_UPDATE',
}

// POST /cases/:caseId/messages (LIA) and POST /students/me/case-messages (client).
export class CreateMessageDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body!: string;

  // Only meaningful on the LIA endpoint — the client endpoint ignores
  // it (a client cannot post a PROGRESS_UPDATE by definition).
  @IsEnum(LiaMessageKindDto)
  @IsOptional()
  kind?: LiaMessageKindDto;
}

// POST /cases/:caseId/messages/document-request (LIA only).
export class RequestDocumentDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestedDocType!: string;
}

// POST /students/me/case-messages/:messageId/fulfil (client only).
export class FulfilRequestDto {
  @IsString()
  @MinLength(1)
  fileId!: string;
}
