import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PR-AGENT-PORTAL phase 1 — clearing an agent's contract by hand.
 *
 * The reason is required, on the same standard as refusing an agent payable.
 * This is a person deciding an agent may work without the agreement the gate
 * exists to require, and the record has to say why — a blank field makes the
 * decision unexplainable later, not merely undocumented.
 */
export class ClearAgentContractDto {
  @IsString({ message: 'Say why this agent may work without a signed contract.' })
  @MinLength(3, { message: 'Say why this agent may work without a signed contract — a few words is enough.' })
  @MaxLength(2000, { message: 'Keep the reason under 2000 characters.' })
  reason!: string;
}
