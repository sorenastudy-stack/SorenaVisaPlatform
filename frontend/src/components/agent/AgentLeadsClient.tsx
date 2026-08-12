'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, GraduationCap, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-AGENT-PORTAL phase 1 — the clients this agent introduced.
//
// Progress, not contact details: the agent introduced these people and already
// knows who they are. What they cannot see from outside is how far each one
// has travelled, which is the whole reason to log in.

interface LeadRow {
  id: string;
  studentName: string | null;
  leadStatus: string;
  caseStage: string | null;
  hasOffer: boolean;
  offerAccepted: boolean;
  startedClasses: boolean;
  introducedAt: string;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** A milestone that has either happened or not — no invented middle states. */
function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${done ? 'text-sorena-jade' : 'text-sorena-text/40'}`}>
      {done ? <CheckCircle2 size={14} /> : <Circle size={14} />} {label}
    </span>
  );
}

export function AgentLeadsClient() {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<LeadRow[]>('/agent/leads')
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load your clients.'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-12 text-sorena-text/60">
        <Loader2 size={18} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-sorena-navy">My clients</h1>
        <p className="mt-1 text-sm text-sorena-text/70">
          Everyone who reached Sorena through you, and how far they have got.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-sorena-text/60">
          Nobody has come through your link yet. Clients appear here as soon as they do.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-sorena-text/60">
            {rows.length} {rows.length === 1 ? 'client' : 'clients'} introduced
          </p>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sorena-navy">{r.studentName ?? 'Unnamed client'}</p>
                    <p className="mt-0.5 text-xs text-sorena-text/50">
                      Introduced {day(r.introducedAt)}
                      {r.caseStage && ` · currently ${r.caseStage.toLowerCase().replace(/_/g, ' ')}`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <Step done label="Introduced" />
                      <Step done={r.hasOffer} label={r.offerAccepted ? 'Offer accepted' : 'Offer received'} />
                      <Step done={r.startedClasses} label="Started classes" />
                    </div>
                  </div>
                  {r.startedClasses && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sorena-jade/10 px-2.5 py-1 text-xs font-semibold text-sorena-jade">
                      <GraduationCap size={14} /> Enrolled
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
