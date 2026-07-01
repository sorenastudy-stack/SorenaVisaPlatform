import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsNotEmpty } from 'class-validator';

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

// PR-BOOKING-4 — paid booking. Slice 1: GAP_CLOSING. Slice 2: + LIA.
export class HoldBookingDto {
  @IsIn(['GAP_CLOSING', 'LIA'])
  type!: 'GAP_CLOSING' | 'LIA';

  @IsISO8601()
  slotStartUtc!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  staffId?: string;
}

export class CheckoutBookingDto {
  @IsString()
  @IsNotEmpty()
  consultationId!: string;

  // PR-WALLET slice 1 — the client must actively tick the cancellation/refund
  // policy checkbox before paying. The server records proof (IP/UA/version)
  // and refuses checkout unless this is true.
  @IsBoolean()
  accepted!: boolean;
}

export class ConfirmBookingDto {
  // Stage 3: only FREE_15 may be confirmed here (no payment). Paid types
  // are rejected until the Stripe flow lands.
  @IsIn(['FREE_15'])
  type!: 'FREE_15';

  @IsISO8601()
  slotStartUtc!: string;

  // Capacity model: the server assigns one of the advisers free at this
  // time. staffId is now an OPTIONAL preference only — if it's still
  // free it's tried first, otherwise the server picks another free adviser.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  staffId?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
