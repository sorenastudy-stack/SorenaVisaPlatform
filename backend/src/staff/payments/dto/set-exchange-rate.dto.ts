import { IsNumber, Max, Min } from 'class-validator';

// PR-PHASE40 — the manually-entered USD→NZD rate.
//
// The bounds are wide on purpose: they are a typo guard (a slipped decimal
// point, an empty field coerced to 0), not an opinion about what the rate
// should be. The service re-checks them, since it is also reachable from
// scripts that never pass through this pipe.

/**
 * Decimal places accepted, and why it is exactly this number.
 *
 * `exchange_rates.rate` is `Decimal(12,6)`. Postgres does not reject a seventh
 * decimal place — it rounds it away. So accepting more here would not store
 * more: a Finance Admin who typed 1.70327893 would be told it saved, and the
 * invoices would be stamped 1.703279. Silently altering the number a GST figure
 * is computed from is worse than refusing it, so the form refuses it and says
 * so. Raising this limit is a schema change, not a validation change.
 *
 * Six is also what the rate sources actually publish — the seeded
 * open.er-api.com row is 1.698185, exactly six.
 */
export const RATE_MAX_DECIMALS = 6;
export const RATE_MIN = 0.01;
export const RATE_MAX = 1000;

export class SetExchangeRateDto {
  // Every message is written for the person typing into the form. The default
  // class-validator text for maxDecimalPlaces is "rate must be a number
  // conforming to the specified constraints", which names no constraint and
  // reached the Finance user verbatim.
  @IsNumber(
    { maxDecimalPlaces: RATE_MAX_DECIMALS },
    { message: `Enter a rate with up to ${RATE_MAX_DECIMALS} decimal places (for example 1.703279).` },
  )
  @Min(RATE_MIN, { message: `The rate must be at least ${RATE_MIN}.` })
  @Max(RATE_MAX, { message: `The rate must be ${RATE_MAX} or less.` })
  rate!: number;
}
