import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

// PR-LIA-1 — DTOs for the LIA's note + decision endpoints.

export class CreateLegalNoteDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body!: string;
}

export enum LegalDecisionDto {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  NEEDS_MORE_INFO = 'NEEDS_MORE_INFO',
  WITHDRAWN = 'WITHDRAWN',
}

export class RecordDecisionDto {
  @IsEnum(LegalDecisionDto)
  decision!: LegalDecisionDto;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  reason!: string;
}
