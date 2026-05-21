'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { ActivityEntry } from './types';

// PR-CONSULT-2 — Activity tab.
//
// Read-only list of audit-log entries linked to this case. The
// server-side summariser produces a human one-liner per row so the
// frontend doesn't have to know every event type.

export function CaseActivityTab({ caseId }: { caseId: string }) {
  const t = useTranslations();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    setError(null);
    api
      .get<ActivityEntry[]>(`/api/staff/cases/${caseId}/activity`)
      .then((rows) => setEntries(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load activity'));
  }, [caseId]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (entries === null) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        Loading activity…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        {t('staff.cases.detail.activity.empty')}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {entries.map((e) => (
          <li key={e.id} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-gray-900 font-medium leading-tight">{e.summary}</div>
              <div className="text-xs text-gray-500 mt-1">
                {e.actorName ? `${e.actorName}` : 'System'}
                {e.actorRole ? ` · ${e.actorRole}` : ''}
              </div>
            </div>
            <div className="text-xs text-gray-400 whitespace-nowrap">
              {formatRelativeTime(e.createdAt)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
