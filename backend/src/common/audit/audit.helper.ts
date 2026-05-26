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
    case 'LEGAL_NOTE_ADDED':
      return 'Legal note added by LIA';
    case 'LEGAL_DECISION_RECORDED': {
      // PR-LIA-1: newValue carries { legalNoteId, decision, reasonLength }.
      const decision = pickString(newV, 'decision');
      return decision
        ? `Legal decision recorded: ${decision}`
        : 'Legal decision recorded';
    }
    case 'LIA_RISK_OVERRIDDEN': {
      const next = pickString(newV, 'riskLevel');
      return next
        ? `Risk level overridden to ${next} by LIA`
        : 'Case risk level overridden by LIA';
    }
    case 'LIA_HARD_STOP_CLEARED':
      return 'Hard stop cleared by LIA';
    case 'LIA_AUTO_ASSIGNED': {
      // PR-LIA-2: newValue carries { liaId, liaName, candidates }.
      const name = pickString(newV, 'liaName');
      return name
        ? `LIA auto-assigned: ${name}`
        : 'LIA auto-assigned (load-balanced)';
    }
    case 'LIA_AUTO_ASSIGN_NO_CANDIDATES':
      return 'Contract signed but no active LIA was available';
    case 'LIA_MANUAL_REASSIGNED': {
      // PR-LIA-2: oldValue { liaId, liaName }, newValue { liaId, liaName, reasonLength }.
      const next = pickString(newV, 'liaName');
      const prev = pickString(entry.oldValue, 'liaName');
      if (next && prev) return `LIA reassigned: ${prev} → ${next}`;
      if (next)         return `LIA assigned manually: ${next}`;
      if (prev)         return `LIA cleared (was ${prev})`;
      return 'LIA assignment changed';
    }
    case 'CASE_MESSAGE_POSTED': {
      // PR-LIA-4: newValue carries { messageId, authorRole, kind, ... }.
      const authorRole = pickString(newV, 'authorRole');
      const kind = pickString(newV, 'kind');
      if (kind === 'PROGRESS_UPDATE') return 'LIA posted a progress update';
      return authorRole === 'CLIENT'
        ? 'Client replied on the case thread'
        : 'LIA sent a message to the client';
    }
    case 'CASE_DOCUMENT_REQUESTED': {
      const docType = pickString(newV, 'requestedDocType');
      return docType
        ? `LIA requested document: ${docType}`
        : 'LIA requested a document from the client';
    }
    case 'CASE_DOCUMENT_FULFILLED':
      return 'Client fulfilled a document request';
    case 'CASE_MESSAGE_READ': {
      // PR-LIA-4: newValue carries { caseId, count, viewer }.
      const count = (typeof newV === 'object' && newV !== null && typeof (newV as { count?: unknown }).count === 'number')
        ? (newV as { count: number }).count
        : null;
      const viewer = pickString(newV, 'viewer');
      const who = viewer === 'CLIENT' ? 'Client' : 'LIA';
      return count !== null
        ? `${who} read ${count} message${count === 1 ? '' : 's'} on the case thread`
        : `${who} read the case thread`;
    }
    case 'LIA_DOCUMENT_DOWNLOADED': {
      // PR-LIA-5: newValue carries { source, sourceRowId, fileName }.
      const fileName = pickString(newV, 'fileName');
      return fileName
        ? `LIA downloaded document: ${fileName}`
        : 'LIA downloaded a client document';
    }
    case 'LIA_DOCUMENT_REVIEWED': {
      // PR-LIA-5: newValue carries { status, source, sourceRowId, reasonLength }.
      // status is 'APPROVED' | 'REJECTED' | 'CLEARED' (the last on DELETE).
      const status = pickString(newV, 'status');
      if (status === 'CLEARED') return 'LIA cleared a document review';
      if (status === 'APPROVED') return 'LIA approved a client document';
      if (status === 'REJECTED') return 'LIA rejected a client document';
      return 'LIA recorded a document review';
    }
    case 'LIA_INZ_DATA_VIEWED':
      // PR-LIA-6: read-only compliance trail. newValue is { caseId }.
      return 'LIA viewed consolidated INZ application data';
    case 'INZ_SUBMITTED': {
      // PR-LIA-7: newValue carries { caseId, inzApplicationNumber, … }.
      const ref = pickString(newV, 'inzApplicationNumber');
      return ref
        ? `Submitted to Immigration NZ (${ref})`
        : 'Submitted to Immigration NZ';
    }
    case 'INZ_SUBMISSION_EDITED':
      // PR-LIA-7: newValue carries the changed fields (any of
      // inzApplicationNumber, inzSubmittedAt, inzSubmissionNotes).
      return 'LIA edited INZ submission details';
    case 'INZ_SUBMISSION_REVERTED': {
      // PR-LIA-7: oldValue carries the previous inzApplicationNumber.
      const prev = pickString(entry.oldValue, 'inzApplicationNumber');
      return prev
        ? `INZ submission reverted (was ${prev})`
        : 'INZ submission reverted';
    }
    case 'VISA_ISSUED': {
      // PR-LIA-8: newValue carries visaStartDate / visaEndDate / fileName.
      const start = pickString(newV, 'visaStartDate');
      const end = pickString(newV, 'visaEndDate');
      if (start && end) {
        return `Visa issued (valid ${start.slice(0, 10)} → ${end.slice(0, 10)})`;
      }
      return 'Visa issued';
    }
    case 'VISA_DECLINED':
      // PR-LIA-8: newValue carries declineReasonHash + length only.
      // The reason itself stays encrypted on the Visa row.
      return 'Visa application declined';
    case 'VISA_RECORD_EDITED': {
      // PR-LIA-8: newValue carries the changed field names.
      if (typeof newV === 'object' && newV !== null) {
        const keys = Object.keys(newV as Record<string, unknown>);
        if (keys.length > 0) {
          return `Visa record edited (${keys.join(', ')})`;
        }
      }
      return 'Visa record edited';
    }
    case 'VISA_RECORD_REVERTED': {
      // PR-LIA-8: oldValue carries the previous outcome.
      const prev = pickString(entry.oldValue, 'outcome');
      return prev
        ? `Visa record reverted (was ${prev})`
        : 'Visa record reverted';
    }
    case 'VISA_DOCUMENT_DOWNLOADED': {
      // PR-LIA-8: newValue carries fileName.
      const fileName = pickString(newV, 'fileName');
      return fileName
        ? `LIA downloaded visa document: ${fileName}`
        : 'LIA downloaded the visa document';
    }
    case 'VISA_EXPIRY_REMINDER_SENT_LIA': {
      // PR-LIA-9: newValue carries { thresholdDays, emailDeliveryStatus, ... }.
      const threshold = (typeof newV === 'object' && newV !== null && typeof (newV as { thresholdDays?: unknown }).thresholdDays === 'number')
        ? (newV as { thresholdDays: number }).thresholdDays
        : null;
      const status = pickString(newV, 'emailDeliveryStatus');
      const delivery = status === 'FAILED' ? ' (delivery failed)' : '';
      return threshold !== null
        ? `Expiry reminder sent to LIA — ${threshold} days${delivery}`
        : `Expiry reminder sent to LIA${delivery}`;
    }
    case 'VISA_EXPIRY_REMINDER_SENT_CLIENT': {
      const threshold = (typeof newV === 'object' && newV !== null && typeof (newV as { thresholdDays?: unknown }).thresholdDays === 'number')
        ? (newV as { thresholdDays: number }).thresholdDays
        : null;
      const status = pickString(newV, 'emailDeliveryStatus');
      const delivery = status === 'FAILED' ? ' (delivery failed)' : '';
      return threshold !== null
        ? `Expiry reminder sent to client — ${threshold} days${delivery}`
        : `Expiry reminder sent to client${delivery}`;
    }
    case 'VISA_EXPIRY_REMINDER_SENT_OWNER': {
      const threshold = (typeof newV === 'object' && newV !== null && typeof (newV as { thresholdDays?: unknown }).thresholdDays === 'number')
        ? (newV as { thresholdDays: number }).thresholdDays
        : null;
      const count = (typeof newV === 'object' && newV !== null && typeof (newV as { recipientCount?: unknown }).recipientCount === 'number')
        ? (newV as { recipientCount: number }).recipientCount
        : null;
      const tail = count !== null && count > 0 ? ` (${count} owner${count === 1 ? '' : 's'})` : '';
      return threshold !== null
        ? `Expiry reminder sent to OWNER — ${threshold} days${tail}`
        : `Expiry reminder sent to OWNER${tail}`;
    }
    case 'VISA_EXPIRY_REMINDER_SKIPPED': {
      const threshold = (typeof newV === 'object' && newV !== null && typeof (newV as { thresholdDays?: unknown }).thresholdDays === 'number')
        ? (newV as { thresholdDays: number }).thresholdDays
        : null;
      const recipient = pickString(newV, 'recipient');
      if (threshold !== null && recipient) {
        return `Expiry reminder skipped (${recipient}, ${threshold} days) — already sent`;
      }
      return 'Expiry reminder skipped — already sent';
    }
    case 'OFFICER_PROFILE_CREATED': {
      // PR-LIA-10: newValue carries { officerId, fullName, branch, duplicateHintId }.
      const name = pickString(newV, 'fullName');
      const branch = pickString(newV, 'branch');
      if (name && branch) return `Officer profile created: ${name} (${branch})`;
      if (name)           return `Officer profile created: ${name}`;
      return 'Officer profile created';
    }
    case 'OFFICER_PROFILE_UPDATED': {
      // PR-LIA-10: newValue carries { officerId, changedFields }.
      if (typeof newV === 'object' && newV !== null) {
        const fields = (newV as { changedFields?: unknown }).changedFields;
        if (Array.isArray(fields) && fields.length > 0) {
          return `Officer profile updated (${fields.join(', ')})`;
        }
      }
      return 'Officer profile updated';
    }
    case 'OFFICER_DELETED': {
      // PR-LIA-10: newValue carries { officerId, fullName }.
      const name = pickString(newV, 'fullName');
      return name ? `Officer deleted: ${name}` : 'Officer deleted';
    }
    case 'OFFICER_OBSERVATION_ADDED': {
      // PR-LIA-10: newValue carries { officerId, observationId, tagsCount, bodyLength }.
      if (typeof newV === 'object' && newV !== null) {
        const tags = (newV as { tagsCount?: unknown }).tagsCount;
        if (typeof tags === 'number' && tags > 0) {
          return `Observation added on officer (${tags} tag${tags === 1 ? '' : 's'})`;
        }
      }
      return 'Observation added on officer';
    }
    case 'OFFICER_OBSERVATION_DELETED':
      return 'Observation deleted by its author';
    case 'CASE_OFFICER_LINKED': {
      // PR-LIA-10: newValue carries { officerId, officerName, linkedOutcome, reLink }.
      const officerName = pickString(newV, 'officerName');
      const outcome = pickString(newV, 'linkedOutcome');
      const reLink = (typeof newV === 'object' && newV !== null && (newV as { reLink?: unknown }).reLink === true);
      const prefix = reLink ? 'Reviewing officer re-linked' : 'Reviewing officer linked';
      if (officerName && outcome) return `${prefix}: ${officerName} (outcome at link: ${outcome})`;
      if (officerName) return `${prefix}: ${officerName}`;
      return prefix;
    }
    case 'CASE_OFFICER_UNLINKED': {
      const officerName = pickString(newV, 'officerName');
      return officerName
        ? `Reviewing officer unlinked (was ${officerName})`
        : 'Reviewing officer unlinked';
    }
    case 'OFFICER_OUTLIER_SCAN_RUN':
      // PR-LIA-11: reserved for a future manual-trigger pattern. The
      // current outlier endpoint is a plain read and writes no audit
      // row. Registered here so a follow-up "scan now + notify" path
      // can write rows that this helper already humanises.
      return 'Officer outlier scan triggered';
    case 'CASE_FILE_NOTE_VIEWED':
      // PR-LIA-12: read-only compliance trail. Fires once per view of
      // the per-case timeline page. newValue: { caseId }.
      return 'Case file note viewed';
    case 'CASE_FILE_NOTE_EXPORTED': {
      // PR-LIA-12: OWNER-only export. newValue: { caseId, format }.
      const fmt = pickString(newV, 'format');
      return fmt
        ? `Case file note exported (${fmt})`
        : 'Case file note exported';
    }
    case 'SCORECARD_SUBMITTED': {
      // PR-SCORECARD-1: newValue { submissionId, band, totalScore, executionEligible }.
      const band = pickString(newV, 'band');
      const total = (typeof newV === 'object' && newV !== null && typeof (newV as { totalScore?: unknown }).totalScore === 'number')
        ? (newV as { totalScore: number }).totalScore
        : null;
      if (band && total !== null) return `Scorecard submitted: ${total}/100 (${band})`;
      if (total !== null)         return `Scorecard submitted: ${total}/100`;
      return 'Scorecard submitted';
    }
    case 'SCORECARD_LEAD_CREATED': {
      // PR-SCORECARD-1: newValue { leadId, scorecardSubmissionId }.
      return 'Lead auto-created from scorecard submission';
    }
    case 'SCORECARD_VIEWED_BY_STAFF':
      return 'Scorecard viewed by staff';
    case 'SCORECARD_BOOKING_LINK_OPENED':
      return 'Scorecard booking link opened by lead';
    case 'VISA_EXPIRY_MANUAL_SWEEP_TRIGGERED': {
      const dispatched = (typeof newV === 'object' && newV !== null && typeof (newV as { dispatched?: unknown }).dispatched === 'number')
        ? (newV as { dispatched: number }).dispatched
        : null;
      const failed = (typeof newV === 'object' && newV !== null && typeof (newV as { failed?: unknown }).failed === 'number')
        ? (newV as { failed: number }).failed
        : null;
      if (dispatched !== null && failed !== null) {
        return `Manual expiry sweep triggered — dispatched ${dispatched}, failed ${failed}`;
      }
      return 'Manual expiry sweep triggered';
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
