// PR-CHECKLIST item 3 — the 2-week CLIENT follow-up during document collection.
// Pure logic, no I/O.
//
// Not to be confused with the 5-working-day follow-up in
// students/admission/follow-up/, which chases the INSTITUTION after a submission.
// This one chases the CLIENT for a document we asked them for and never got.
// Different party, different clock, and — deliberately — a different trigger:
// a DOCUMENT_REQUEST message that has no fulfilledAt.
//
// Calendar days, not working days. The institution rule uses working days
// because it is aimed at someone's business calendar; a client owes us their own
// passport scan, and "two weeks" to a person means fourteen days.

// The notification type. Lives here rather than in the service because both the
// sweep that raises the notice and the fulfilment path that clears it need it,
// and the fulfilment path must not have to depend on the sweep.
export const CLIENT_DOCUMENT_FOLLOW_UP = 'CLIENT_DOCUMENT_FOLLOW_UP';

export const CLIENT_FOLLOW_UP_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a request first becomes chaseable. */
export function followUpDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + CLIENT_FOLLOW_UP_DAYS * DAY_MS);
}

export function isClientFollowUpDue(requestedAt: Date, now: Date): boolean {
  return now.getTime() >= followUpDueAt(requestedAt).getTime();
}

// The link is doing two jobs: it is where the notification sends you, and it is
// the idempotency key. Notification has no reference column, and one message ==
// one link means "have we already raised this?" is answerable without adding a
// migration for a field that would only ever hold this id.
export function followUpLink(caseId: string, messageId: string): string {
  return `/staff/cases/${caseId}?documentRequest=${messageId}`;
}

export function followUpTitle(requestedDocType: string | null): string {
  const what = requestedDocType?.trim() ? requestedDocType.trim() : 'a document';
  return `Client has not sent ${what} — requested ${CLIENT_FOLLOW_UP_DAYS} days ago`;
}

export interface OutstandingRequest {
  messageId: string;
  caseId: string;
  requestedAt: Date;
  requestedDocType: string | null;
  /** Who asked for it — they own the chase. Null when unresolvable. */
  requesterId: string | null;
  /** The case's Admission Specialist, used when the requester is unknown. */
  consultantId: string | null;
}

export interface FollowUpNotice {
  userId: string;
  caseId: string;
  messageId: string;
  title: string;
  link: string;
}

/**
 * Decide who to nudge. A request earns a notice when it is past due and has not
 * already produced one (matched by link, so re-running the sweep on any schedule
 * is safe).
 *
 * A request with no requester AND no consultant is skipped rather than sent to
 * some fallback human: a notification nobody owns is noise, and it would be
 * created fresh on every sweep for the rest of the case's life.
 */
export function planClientDocumentFollowUps(
  requests: OutstandingRequest[],
  alreadyNotifiedLinks: ReadonlySet<string>,
  now: Date,
): FollowUpNotice[] {
  const notices: FollowUpNotice[] = [];

  for (const r of requests) {
    if (!isClientFollowUpDue(r.requestedAt, now)) continue;

    const userId = r.requesterId ?? r.consultantId;
    if (!userId) continue;

    const link = followUpLink(r.caseId, r.messageId);
    if (alreadyNotifiedLinks.has(link)) continue;

    notices.push({
      userId,
      caseId: r.caseId,
      messageId: r.messageId,
      title: followUpTitle(r.requestedDocType),
      link,
    });
  }

  return notices;
}
