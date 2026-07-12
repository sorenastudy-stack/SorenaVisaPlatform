'use client';

import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import type { DocReviewStatus } from './useDocumentReviewStatuses';

// Item 1 — calm, human review-status badge (navy/gold portal styling).
//   APPROVED   → "Approved"            (jade)
//   UNREVIEWED → "We're reviewing this" (navy, muted)
//   REJECTED   → "Please re-upload"     (amber) + the reason line underneath
// No raw enums, no reviewer identity. `reason` is only ever set on REJECTED
// rows (server-gated) and is the client-safe text or the generic fallback.

export function DocumentReviewBadge({
  status,
  reason,
}: {
  status: DocReviewStatus;
  reason?: string | null;
}) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sorena-jade/30 bg-sorena-jade/10 px-2.5 py-0.5 text-xs font-semibold text-sorena-jade">
        <CheckCircle2 size={13} /> Approved
      </span>
    );
  }

  if (status === 'REJECTED') {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          <AlertTriangle size={13} /> Please re-upload
        </span>
        {reason && <p className="text-xs leading-relaxed text-amber-800/80">{reason}</p>}
      </div>
    );
  }

  // UNREVIEWED (default) — reassure, don't alarm.
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sorena-navy/10 bg-sorena-navy/5 px-2.5 py-0.5 text-xs font-medium text-sorena-navy/60">
      <Clock size={13} /> We&apos;re reviewing this
    </span>
  );
}
