import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// PR-RECS-2 (slice 2) — DTOs for the priority-slot endpoints. Boundary guard only;
// the slot-rule enforcement lives in validateSlotSelection (service).

// Staff: change which programme sits at ONE position (null = clear the slot).
export class StaffSwapSlotDto {
  @IsInt() @Min(1) @Max(20)
  position!: number;

  @IsOptional() @IsString()
  programmeId?: string | null;
}

// Client: the new ordering — programmeId per position (index 0 = position 1),
// null = an empty slot. Length + set-equality + slot rules validated server-side.
export class ReorderSlotsDto {
  @IsArray()
  order!: (string | null)[];
}
