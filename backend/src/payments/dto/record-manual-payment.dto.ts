import { IsInt, IsNotEmpty, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

// Body DTO for POST /payments/case/:caseId/manual.
//
// Staff-side "I received a cash/bank transfer for this case" entry. The
// caseId comes from the URL; the body carries the amount + optional
// currency + optional free-text note + receipt document id. Amount is
// integer cents to match how the Stripe webhook stores
// `paymentIntent.amount_received` on the existing Payment rows (no
// Decimal coercion needed at the DB layer).
//
// Phase 6.5 — receiptDocumentId is REQUIRED. The staff UI uploads the
// receipt via /cases/:caseId/documents FIRST, then sends the returned
// document id here. The service validates the document exists AND
// belongs to this case (a caller can't attach someone else's document).

export class RecordManualPaymentDto {
  @IsInt({ message: 'amount must be an integer (cents)' })
  @Min(1, { message: 'amount must be at least 1 cent' })
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency must be a 3-letter ISO code (e.g. nzd, usd)' })
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsString()
  @IsNotEmpty({
    message: 'receiptDocumentId is required — upload the receipt first',
  })
  receiptDocumentId!: string;
}
