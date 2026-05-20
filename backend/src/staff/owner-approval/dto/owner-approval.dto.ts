// PR-CONSULT-1 — Owner-approval DTOs.
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum OwnerApprovalActionTypeDto {
  CREATE_STAFF_USER       = 'CREATE_STAFF_USER',
  CHANGE_STAFF_ROLE       = 'CHANGE_STAFF_ROLE',
  DEACTIVATE_STAFF        = 'DEACTIVATE_STAFF',
  DELETE_CASE             = 'DELETE_CASE',
  DELETE_STUDENT          = 'DELETE_STUDENT',
  ISSUE_REFUND            = 'ISSUE_REFUND',
  CHANGE_PLATFORM_SETTING = 'CHANGE_PLATFORM_SETTING',
}

export class CreateApprovalRequestDto {
  @IsEnum(OwnerApprovalActionTypeDto)
  actionType!: OwnerApprovalActionTypeDto;

  // Free-form JSON payload describing the action. Validated per
  // actionType inside the executor — not at the DTO layer because
  // the payload shape varies dramatically across action types.
  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(2000)
  decisionNote?: string;
}
