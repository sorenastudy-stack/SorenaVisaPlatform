'use client';

import { toast } from 'sonner';
import Link from 'next/link';

// PR-CONSULT-3 — Shared notification helpers for the two-path
// execution UX. SUPER_ADMIN actions queue and we link them to
// `/staff/approvals?tab=mine`; OWNER inline actions just show a
// neutral success.

export function notifySentForApproval(message: string, linkLabel: string) {
  toast.info(
    <span>
      {message}{' '}
      <Link
        href="/staff/approvals?tab=mine"
        className="font-semibold underline text-[#1e3a5f]"
      >
        {linkLabel}
      </Link>
    </span>,
    { duration: 6000 },
  );
}

export function notifyExecutionFailed(message: string) {
  toast.error(message, { duration: 8000 });
}
