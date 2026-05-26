import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { CaseDocumentReviewStatus } from '@prisma/client';

// PR-LIA-5 — Body for POST /cases/:caseId/documents/:source/:rowId/review.

export class ReviewDocumentDto {
  @IsEnum(CaseDocumentReviewStatus)
  status!: CaseDocumentReviewStatus;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
