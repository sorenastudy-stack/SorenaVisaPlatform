// Render-ready item types for the weekly client digest.
//
// Each item carries already-resolved display values — no raw entityId,
// no internal fields (risk levels, reject reasons, reassignment reasons,
// raw notes). The email template can interpolate the `data` payload
// directly without joining anything back to the database.
//
// Discriminated by `type`. Add a new event type by extending the union
// and the switch in DigestService.

export interface DigestItemINZSubmitted {
  type:        'INZ_SUBMITTED';
  occurredAt:  Date;
  data: { reference: string | null };
}

export interface DigestItemVisaIssued {
  type:        'VISA_ISSUED';
  occurredAt:  Date;
  data: { visaStartDate: string | null; visaEndDate: string | null };
}

export interface DigestItemLiaAutoAssigned {
  type:        'LIA_AUTO_ASSIGNED';
  occurredAt:  Date;
  data: { staffName: string | null };
}

export interface DigestItemLiaManualReassigned {
  type:        'LIA_MANUAL_REASSIGNED';
  occurredAt:  Date;
  data: { staffName: string | null };
}

export interface DigestItemCaseDocumentRequested {
  type:        'CASE_DOCUMENT_REQUESTED';
  occurredAt:  Date;
  data: { documentLabel: string };
}

export interface DigestItemPaymentRecordedManual {
  type:        'PAYMENT_RECORDED_MANUAL';
  occurredAt:  Date;
  data: { amount: number; currency: string };
}

export interface DigestItemPaymentVerificationConfirmed {
  type:        'PAYMENT_VERIFICATION_CONFIRMED';
  occurredAt:  Date;
  data: { amount: number; currency: string };
}

export interface DigestItemDocumentUploaded {
  type:        'DOCUMENT_UPLOADED';
  occurredAt:  Date;
  data: { documentName: string };
}

export interface DigestItemMeetingCreated {
  type:        'MEETING_CREATED';
  occurredAt:  Date;
  data: { when: Date | null };
}

export interface DigestItemMeetingUpdated {
  type:        'MEETING_UPDATED';
  occurredAt:  Date;
  data: { when: Date | null };
}

export interface DigestItemMeetingCancelled {
  type:        'MEETING_CANCELLED';
  occurredAt:  Date;
  data: { when: Date | null };
}

export interface DigestItemTicketMessageSent {
  type:        'TICKET_MESSAGE_SENT';
  occurredAt:  Date;
  data: { ticketTopic: string };
}

export interface DigestItemTicketStatusChanged {
  type:        'TICKET_STATUS_CHANGED';
  occurredAt:  Date;
  data: { ticketTopic: string; newStatus: 'RESOLVED' | 'CLOSED' };
}

export type DigestItem =
  | DigestItemINZSubmitted
  | DigestItemVisaIssued
  | DigestItemLiaAutoAssigned
  | DigestItemLiaManualReassigned
  | DigestItemCaseDocumentRequested
  | DigestItemPaymentRecordedManual
  | DigestItemPaymentVerificationConfirmed
  | DigestItemDocumentUploaded
  | DigestItemMeetingCreated
  | DigestItemMeetingUpdated
  | DigestItemMeetingCancelled
  | DigestItemTicketMessageSent
  | DigestItemTicketStatusChanged;
