import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Body DTO for POST /payments/:paymentId/reject.
//
// Finance staff reject a payment (wrong amount, bad receipt, suspected
// duplicate, etc). The note (reason) is REQUIRED — a rejection that
// doesn't say why is a footgun for everyone downstream who has to
// figure out what to do about the flagged row.

export class RejectPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required.' })
  @MaxLength(500)
  note!: string;
}
