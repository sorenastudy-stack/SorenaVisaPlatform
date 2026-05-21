// PR-CONSULT-3 — Approvals API types.
//
// Mirrors the shape returned by OwnerApprovalService.shapeForApi.
// Payload comes back decrypted as a JSON object; the renderer
// dispatcher picks the right component based on actionType.

export type ApprovalActionType =
  | 'CREATE_STAFF_USER'
  | 'CHANGE_STAFF_ROLE'
  | 'DEACTIVATE_STAFF'
  | 'DELETE_CASE'
  | 'DELETE_STUDENT'
  | 'ISSUE_REFUND'
  | 'CHANGE_PLATFORM_SETTING';

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED'
  | 'EXECUTION_FAILED';

export interface ApprovalRequest {
  id:             string;
  requestedById:  string;
  requestedBy:    { id: string; name: string | null; email: string } | null;
  actionType:     ApprovalActionType;
  payload:        Record<string, unknown>;
  reason:         string | null;
  status:         ApprovalStatus;
  decidedById:    string | null;
  decidedAt:      string | null;
  decisionNote:   string | null;
  expiresAt:      string;
  executedAt:     string | null;
  executionError: string | null;
  createdAt:      string;
}

export interface ApproveResponse {
  approval:        ApprovalRequest;
  executionResult: { ok: boolean; error?: string };
}
