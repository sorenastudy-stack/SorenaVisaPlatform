import { IsIn } from 'class-validator';

// PR-WALLET slice 2 — staff marks a consultation's outcome.
export class MarkConsultationStatusDto {
  @IsIn(['NO_SHOW', 'COMPLETED', 'CANCELLED'])
  status!: 'NO_SHOW' | 'COMPLETED' | 'CANCELLED';
}
