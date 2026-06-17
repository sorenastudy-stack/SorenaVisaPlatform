import { IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

// Body DTO for POST /payments/case/:caseId/manual.
//
// Staff-side "I received a cash/bank transfer for this case" entry. The
// caseId comes from the URL; the body only carries the amount + optional
// currency + optional free-text note. Amount is integer cents to match
// how the Stripe webhook stores `paymentIntent.amount_received` on the
// existing Payment rows (no Decimal coercion needed at the DB layer).

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
}
