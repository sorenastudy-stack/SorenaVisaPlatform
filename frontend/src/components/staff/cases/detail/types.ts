// PR-CONSULT-2 — Case detail shared API types.
//
// These match the /api/staff/cases/:id response shape. Keeping them
// in one file lets every detail-tab component import a stable type
// without re-declaring the slot interfaces.

// PR-CLIENT-CONSULTANT-SLOT — CLIENT_CONSULTANT is the "Client Consultant" slot
// (Case.consultantId), distinct from CONSULTANT (= "Admission Specialist" on
// Case.ownerId). Wired to PATCH /cases/:id/consultant.
export type RoleSlot = 'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE' | 'CLIENT_CONSULTANT';

export interface SlotAssignee {
  id:   string;
  name: string;
  role: string;
  photoUrl: string | null;
}

export interface CaseDetail {
  id:        string;
  status:    string;
  stage:     string;
  notes:     string | null; // PR-OPS-CASES: editable on the overview tab
  visaType:  string | null; // PR-CONTRACT-CAPTURE — captured from the signed contract (read-only)
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
