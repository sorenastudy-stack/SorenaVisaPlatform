import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// PR-WALLET slice 2 — staff marks a consultation's outcome.
export class MarkConsultationStatusDto {
  @IsIn(['NO_SHOW', 'COMPLETED', 'CANCELLED'])
  status!: 'NO_SHOW' | 'COMPLETED' | 'CANCELLED';
}

// PR-CONTRACT-GATE (Phase A) — the LIA's verdict on an LIA consultation. Reuses
// the LegalDecision vocabulary. `notes` is optional free-text context.
export class RecordLiaDecisionDto {
  @IsIn(['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'WITHDRAWN'])
  decision!: 'APPROVED' | 'REJECTED' | 'NEEDS_MORE_INFO' | 'WITHDRAWN';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// PR-CARD-REFUND — optional free-text reason recorded on the refund + Stripe
// metadata (e.g. "service not provided", "legal case"). Amount is NOT accepted
// from the client — the server always refunds the full captured amount.
export class RefundToCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
