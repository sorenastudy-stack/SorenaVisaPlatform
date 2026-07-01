'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';

// PR-STAFF-HR (Phase 3) — "My Job Description" tab. Read-only self-view of the
// admin-set text (backend scopes to req.user). Whitespace preserved.

interface JobDesc { text: string | null; setAt: string | null; }

export function MyJobDescriptionTab() {
  const [data, setData] = useState<JobDesc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<JobDesc>('/staff/me/job-description')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { /* non-fatal — show empty state */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (!loaded) {
    return <div className="flex items-center gap-2 py-8 text-sm text-sorena-text/50"><Loader2 size={16} className="animate-spin" /> Loading…</div>;
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">My job description</h2>
        {data?.setAt && <span className="text-xs text-sorena-text/40">Updated {formatDate(data.setAt)}</span>}
      </div>
      {data?.text ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-sorena-navy">{data.text}</p>
      ) : (
        <p className="mt-4 text-sm text-sorena-text/50">No job description has been set for you yet. Your administrator will add it here.</p>
      )}
    </section>
  );
}
