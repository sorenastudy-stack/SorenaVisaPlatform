import { IsEmail, IsIn, IsString, Length } from 'class-validator';
import { PAYER_RELATIONSHIPS } from '../third-party-payer';

// PR-CHECKLIST item 11 — optional payer block on the case-keyed payment links.
//
// Optional as a whole: omitting it means the client is paying, which is both the
// default and what every existing caller does, so no current request breaks.
//
// But every field inside it is REQUIRED once the block is present. A
// half-declared third party — a name with no way to contact them, or a payer
// with no stated relationship to the applicant — is worse than none, because it
// looks like a completed compliance record while answering none of the questions
// that record exists to answer.
export class ThirdPartyPayerDto {
  @IsString()
  @Length(2, 200, { message: "payer.name must be the payer's full name" })
  name!: string;

  @IsEmail({}, { message: 'payer.email must be a valid email address' })
  email!: string;

  @IsIn(PAYER_RELATIONSHIPS as readonly string[], {
    message: `payer.relationship must be one of: ${PAYER_RELATIONSHIPS.join(', ')}`,
  })
  relationship!: string;
}
