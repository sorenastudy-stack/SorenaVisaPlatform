import { IsIn, IsNotEmpty, IsString } from 'class-validator';

// Body DTO for POST /payments/consultation-link.
//
// The route used to do `@Body('leadId') leadId: string, @Body('consultationType')
// consultationType: string` — a raw field-by-field destructure that bypassed
// the global ValidationPipe entirely (no whitelist, no `forbidNonWhitelisted`,
// no type coercion, no enum check). Missing or malformed fields reached the
// service as `undefined` and produced opaque errors from the Stripe call.
//
// With this DTO the global pipe enforces: leadId is a non-empty string;
// consultationType is one of the five known keys consumed by
// PaymentsService.createConsultationPaymentLink (CONSULTATION_AMOUNTS).

export const CONSULTATION_TYPES = [
  'GAP_CLOSING',
  'ADMISSION_CONSULTATION',
  'LIA_CONSULTATION',
  'ACCOUNT_OPENING',
  'FREE_SESSION',
] as const;

export class CreatePaymentLinkDto {
  @IsString()
  @IsNotEmpty()
  leadId!: string;

  @IsString()
  @IsIn(CONSULTATION_TYPES as readonly string[], {
    message: `consultationType must be one of: ${CONSULTATION_TYPES.join(', ')}`,
  })
  consultationType!: string;
}
