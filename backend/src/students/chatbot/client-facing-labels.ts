import { VisaCaseStatus, VisaMeetingStatus } from '@prisma/client';

// PR-PORTAL-EMPTY-STATES — what the assistant is allowed to know a case "is".
//
// The chatbot context carried `caseStage: visaCase.status` — the raw enum — so
// the model repeated it back verbatim: "your case is currently in **DRAFT**
// stage". DRAFT is a column value, not a thing a client has any reason to
// recognise, and the rest of the portal says "We're preparing your application"
// for the same state.
//
// The fix is to translate BEFORE the model sees it rather than asking the model
// not to say it. A prompt instruction is a request — it holds until someone
// phrases a question differently. If the raw value never enters the context, it
// cannot come back out, whatever is asked.
//
// Both maps are `Record<Enum, string>`, so adding a status to the schema fails
// the build here until somebody decides what a client should be told it means.
// That is deliberate: the compiler is the thing standing between a new enum
// value and a client reading it.

/** Client-facing wording for a case status. Mirrors the portal's own copy. */
export const CASE_STAGE_LABEL: Record<VisaCaseStatus, string> = {
  DRAFT:                'being prepared',
  SUBMITTED_FOR_REVIEW: 'submitted for review',
  REVIEWED:             'reviewed by a consultant',
  READY_FOR_INZ:        'ready to file with Immigration New Zealand',
  INZ_SUBMITTED:        'filed with Immigration New Zealand',
  APPROVED:             'approved',
  DECLINED:             'needs attention',
};

/** Client-facing wording for a meeting status. */
export const MEETING_STATUS_LABEL: Record<VisaMeetingStatus, string> = {
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW:   'missed',
};

/**
 * Never returns the raw value.
 *
 * An unmapped status — one added to the schema without being routed through
 * here — degrades to a neutral phrase rather than leaking the enum. The
 * exhaustive Record above should make that unreachable; this is the belt to
 * its braces, because "unreachable" and "unreached" are different things.
 */
export function caseStageLabel(status: VisaCaseStatus | null | undefined): string | null {
  if (!status) return null;
  return CASE_STAGE_LABEL[status] ?? 'in progress';
}

export function meetingStatusLabel(status: string): string {
  return MEETING_STATUS_LABEL[status as VisaMeetingStatus] ?? 'other';
}
