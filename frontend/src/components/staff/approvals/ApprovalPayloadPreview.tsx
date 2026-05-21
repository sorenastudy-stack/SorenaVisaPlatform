'use client';

import { CreateStaffUserPayload } from './payload-renderers/CreateStaffUserPayload';
import { ChangeStaffRolePayload } from './payload-renderers/ChangeStaffRolePayload';
import { DeactivateStaffPayload } from './payload-renderers/DeactivateStaffPayload';
import { DeleteCasePayload } from './payload-renderers/DeleteCasePayload';
import { DeleteStudentPayload } from './payload-renderers/DeleteStudentPayload';
import { IssueRefundPayload } from './payload-renderers/IssueRefundPayload';
import { ChangePlatformSettingPayload } from './payload-renderers/ChangePlatformSettingPayload';
import { HardDeleteStaffPayload } from './payload-renderers/HardDeleteStaffPayload';
import type { ApprovalActionType } from './types';

// PR-CONSULT-3 — Approval payload dispatcher.
//
// Picks the right renderer based on the request's actionType.
// Unknown types fall back to a JSON dump so the OWNER can still
// inspect what they're approving (better than a blank panel).

export function ApprovalPayloadPreview({
  type,
  payload,
}: {
  type:    ApprovalActionType | string;
  payload: Record<string, unknown>;
}) {
  switch (type) {
    case 'CREATE_STAFF_USER':       return <CreateStaffUserPayload payload={payload} />;
    case 'CHANGE_STAFF_ROLE':       return <ChangeStaffRolePayload payload={payload} />;
    case 'DEACTIVATE_STAFF':        return <DeactivateStaffPayload payload={payload} />;
    case 'DELETE_CASE':             return <DeleteCasePayload payload={payload} />;
    case 'DELETE_STUDENT':          return <DeleteStudentPayload payload={payload} />;
    case 'ISSUE_REFUND':            return <IssueRefundPayload payload={payload} />;
    case 'CHANGE_PLATFORM_SETTING': return <ChangePlatformSettingPayload payload={payload} />;
    case 'HARD_DELETE_STAFF':       return <HardDeleteStaffPayload payload={payload} />;
    default:
      return (
        <pre className="text-xs bg-gray-50 rounded-lg px-3 py-2 overflow-x-auto">
          {JSON.stringify(payload, null, 2)}
        </pre>
      );
  }
}
