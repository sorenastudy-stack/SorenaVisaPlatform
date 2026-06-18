import { IsOptional, IsString, MaxLength } from 'class-validator';

// Body DTO for POST /payments/:paymentId/confirm.
//
// Finance staff confirm a payment is real and verified. The note is
// OPTIONAL — it's a confirm comment, not a reason for action. For
// the reject path the note IS required; see RejectPaymentDto.

export class VerifyPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
