import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

// Body DTO for POST /payments/case/:caseId/custom-link.
//
// Staff-side flow: the operator enters a custom dollar amount in the
// staff Payments tab; the frontend converts that to integer cents
// (EPSILON-safe) and sends it here. The backend creates a Stripe
// Payment Link with INLINE price_data (no prices.create call — the
// custom amounts are bespoke per send, no point cluttering the Stripe
// Dashboard with a Price per link).
//
// Caps:
//   • amount  — positive integer cents; max 1,000,000 cents = NZD 10,000.00.
//               Generous for any Sorena service today and easy to widen
//               later; tight enough that a typo can't accidentally create
//               a million-dollar link.
//   • currency — optional ISO 4217 3-letter code; defaults to nzd at the
//                service layer.

export class CreateCaseCustomLinkDto {
  @IsInt({ message: 'amount must be an integer (cents)' })
  @Min(1,         { message: 'amount must be at least 1 cent' })
  @Max(1_000_000, { message: 'amount must be 10,000.00 or less (1,000,000 cents)' })
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency must be a 3-letter ISO code (e.g. nzd, usd)' })
  currency?: string;
}
