import { IsIn, IsISO8601, IsOptional, IsString, IsNotEmpty } from 'class-validator';

// PR-BOOKING-3 — request DTOs for the client booking flow.

export class SlotsQueryDto {
  // Stage 3 wires FREE_15 only; the others are accepted by validation so
  // the same endpoint can serve paid types in the next stage.
  @IsIn(['FREE_15', 'GAP_CLOSING', 'LIA'])
  type!: 'FREE_15' | 'GAP_CLOSING' | 'LIA';

  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

export class ConfirmBookingDto {
  // Stage 3: only FREE_15 may be confirmed here (no payment). Paid types
  // are rejected until the Stripe flow lands.
  @IsIn(['FREE_15'])
  type!: 'FREE_15';

  @IsString()
  @IsNotEmpty()
  adviserId!: string;

  @IsISO8601()
  slotStartUtc!: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
