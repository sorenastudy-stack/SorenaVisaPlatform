// PR-CONSULT-2 — Audit-entry summariser.
//
// Returns a one-line human string for an audit_logs row. Used by the
// staff case-detail "Activity" tab to render entries without each
// frontend having to know every event-type's i18n key.
//
// Strategy:
//   1. Known event types get a hand-tuned summary that uses the
//      row's newValue / oldValue / entityType to fill in context
//      (role slot for an assignment, ticket subject, etc.).
//   2. Unknown event types fall back to humanising the SCREAMING_SNAKE
//      string into "Sentence case".
//
// We deliberately don't decrypt encrypted columns here (ticket
// subjects, meeting subjects, etc.) — the summariser must remain
// pure / synchronous because it runs over the activity feed in a
// `.map()`. If we ever need decrypted detail in the feed, the
// service that loads the rows should decrypt + attach the plaintext
// to a `metadata` field that the summariser can read.

export interface AuditEntryLike {
  eventType: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
}

// Internal — turn SOME_EVENT_TYPE into "Some event type".
function humaniseEventType(s: string): string {
  if (!s) return 'Activity';
  const lower = s.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Pull a string field off the row's newValue (or oldValue) JSON blob.
function pickString(blob: unknown, key: string): string | null {
  if (typeof blob !== 'object' || blob === null) return null;
  const v = (blob as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function summarizeAuditEntry(entry: AuditEntryLike): string {
  const event = entry.eventType ?? entry.action ?? '';
  const newV = entry.newValue;

  switch (event) {
    case 'STAFF_ASSIGNED_AUTO': {
      const slot = pickString(newV, 'roleSlot');
      return slot
        ? `${slot} slot auto-assigned`
        : 'Staff member auto-assigned';
    }
    case 'STAFF_ASSIGNED_MANUAL': {
      const slot = pickString(newV, 'roleSlot');
      return slot
        ? `${slot} slot assigned manually`
        : 'Staff member assigned';
    }
    case 'STAFF_REASSIGNED': {
      const slot = pickString(newV, 'roleSlot');
      return slot
        ? `${slot} slot reassigned to a new staff member`
        : 'Staff assignment changed';
    }
    case 'MEETING_CREATED':
      return 'Meeting scheduled';
    case 'MEETING_UPDATED':
      return 'Meeting details updated';
    case 'MEETING_CANCELLED':
      return 'Meeting cancelled';
    case 'MEETING_COMPLETED':
      return 'Meeting marked complete';
    case 'TICKET_CREATED':
      return 'Support ticket opened';
    case 'TICKET_MESSAGE_SENT':
      return 'New message on support ticket';
    case 'TICKET_CLOSED':
      return 'Support ticket closed';
    case 'CHAT_ESCALATION_ACCEPTED':
      return 'Chat conversation escalated to support ticket';
    case 'STAFF_PROFILE_UPDATED': {
      // PR-CONSULT-4: newValue carries { changedFields: [...] }
      if (typeof newV === 'object' && newV !== null) {
        const fields = (newV as { changedFields?: unknown }).changedFields;
        if (Array.isArray(fields) && fields.length > 0) {
          return `Staff profile updated (${fields.join(', ')})`;
        }
      }
      return 'Staff profile updated';
    }
    case 'STAFF_HARD_DELETED': {
      // PR-CONSULT-4: newValue carries deletedUserName + role + email.
      const name = pickString(newV, 'deletedUserName');
      const role = pickString(newV, 'deletedUserRole');
      if (name && role) return `Hard-deleted staff: ${name} (${role})`;
      if (name)         return `Hard-deleted staff: ${name}`;
      return 'Staff user permanently deleted';
    }
    case 'STAFF_ROLE_NORMALIZED_FROM_SALES':
      return 'Staff role normalised from SALES to CONSULTANT';
    case 'WIX_LEAD_CAPTURED': {
      // PR-WIX-1: newValue carries { leadId, source, email_masked }.
      const masked = pickString(newV, 'email_masked');
      return masked
        ? `Lead captured via Wix (${masked})`
        : 'Lead captured via Wix webhook';
    }
    case 'STATUS_CHANGED': {
      const status = pickString(newV, 'status');
      return status ? `Case status changed to ${status}` : 'Case status changed';
    }
    case 'DOCUMENT_RECORDED':
      return entry.entityId
        ? `Document ${entry.entityId} uploaded`
        : 'Document uploaded';
    case 'DOCUMENT_REMOVED':
      return entry.entityId
        ? `Document ${entry.entityId} removed`
        : 'Document removed';
    case 'STEP_STARTED':
      return entry.entityType
        ? `Started ${entry.entityType}`
        : 'Visa step started';
    case 'STEP_SAVED':
      return entry.entityType
        ? `Saved ${entry.entityType}`
        : 'Visa step saved';
    default:
      return humaniseEventType(event);
  }
}
