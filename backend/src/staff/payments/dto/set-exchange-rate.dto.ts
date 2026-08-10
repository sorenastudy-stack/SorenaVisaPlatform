import { IsNumber, Max, Min } from 'class-validator';

// PR-PHASE40 — the manually-entered USD→NZD rate.
//
// The bounds are wide on purpose: they are a typo guard (a slipped decimal
// point, an empty field coerced to 0), not an opinion about what the rate
// should be. The service re-checks them, since it is also reachable from
// scripts that never pass through this pipe.
export class SetExchangeRateDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.01)
  @Max(1000)
  rate!: number;
}
