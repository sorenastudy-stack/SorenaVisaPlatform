import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  INTAKE_STARTED = 'INTAKE_STARTED',
  INTAKE_COMPLETED = 'INTAKE_COMPLETED',
  SCORING_DONE = 'SCORING_DONE',
  QUALIFIED = 'QUALIFIED',
  NURTURE = 'NURTURE',
  EXECUTING = 'EXECUTING',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST',
  DISQUALIFIED = 'DISQUALIFIED',
}

export class UpdateLeadStatusDto {
  @IsNotEmpty()
  @IsEnum(LeadStatus)
  status: LeadStatus;

  @IsOptional()
  @IsString()
  disqualificationReason?: string;
}

const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  [LeadStatus.NEW]: [LeadStatus.CONTACTED],
  [LeadStatus.CONTACTED]: [LeadStatus.INTAKE_STARTED],
  [LeadStatus.INTAKE_STARTED]: [LeadStatus.INTAKE_COMPLETED],
  [LeadStatus.INTAKE_COMPLETED]: [LeadStatus.SCORING_DONE],
  [LeadStatus.SCORING_DONE]: [LeadStatus.QUALIFIED, LeadStatus.NURTURE, LeadStatus.DISQUALIFIED],
  [LeadStatus.QUALIFIED]: [LeadStatus.EXECUTING, LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST],
  [LeadStatus.NURTURE]: [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.DISQUALIFIED],
  [LeadStatus.EXECUTING]: [LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST],
  [LeadStatus.CLOSED_WON]: [],
  [LeadStatus.CLOSED_LOST]: [],
  [LeadStatus.DISQUALIFIED]: [],
};

export function isValidTransition(fromStatus: LeadStatus, toStatus: LeadStatus): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}
