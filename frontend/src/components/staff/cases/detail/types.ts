// PR-CONSULT-2 — Case detail shared API types.
//
// These match the /api/staff/cases/:id response shape. Keeping them
// in one file lets every detail-tab component import a stable type
// without re-declaring the slot interfaces.

export type RoleSlot = 'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE';

export interface SlotAssignee {
  id:   string;
  name: string;
  role: string;
}

export interface CaseDetail {
  id:        string;
  status:    string;
  stage:     string;
  createdAt: string;
  updatedAt: string;
  student: {
    id:        string;
    firstName: string;
    lastName:  string;
    email:     string;
    locale:    string;
    phone:     string | null;
  };
  assignments: Record<RoleSlot, SlotAssignee | null>;
}

export interface ActivityEntry {
  id:        string;
  eventType: string;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  summary:   string;
}

export interface AvailableStaffRow {
  staffId:               string;
  name:                  string;
  activeAssignmentCount: number;
}
