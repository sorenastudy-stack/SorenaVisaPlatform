import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Refusing a share requires saying why.
 *
 * The refund queue's decision note is optional. This one is not: an agent
 * payable is money owed to somebody outside the company, and months later a
 * reconciliation asks "why was this not paid?" — a blank answer makes the row
 * unexplainable rather than merely undocumented.
 *
 * The service trims and re-checks; this is the message a person reads.
 */
export class RejectPayableDto {
  @IsString({ message: 'Say why this share is not owed.' })
  @MinLength(3, { message: 'Say why this share is not owed — a few words is enough.' })
  @MaxLength(2000, { message: 'Keep the reason under 2000 characters.' })
  reason!: string;
}
