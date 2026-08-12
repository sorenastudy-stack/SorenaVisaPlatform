'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-AGENT-PORTAL phase 1 — what the agent is owed, and what has been paid.
//
// The same figures Finance and the Owner see on the accounting dashboard,
// filtered to this agent. A refused share is shown WITH its reason: the agent
// is entitled to know a commission was not paid and why, and hiding it would
// leave them chasing a number that quietly disappeared.

interface PayableRow {
  id: string;
  studentName: string | null;
  providerName: string | null;
  programmeName: string | null;
  amountMinorUnits: number;
  currency: string;
  ratePercent: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  paidAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface Payload {
  items: PayableRow[];
  totals: {
    owedByCurrency: Record<string, number>;
    paidByCurrency: Record<string, number>;
  };
}

const money = (currency: string, minorUnits: number) =>
  `${currency} ${(minorUnits / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

/** Plain words, not the enum. "PENDING" means nothing to somebody outside the company. */
const STATUS: Record<string, { label: string; className: string }> = {
  PENDING:  { label: 'Being reviewed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'Approved for payment', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  PAID:     { label: 'Paid', className: 'bg-sorena-jade/10 text-sorena-jade border-sorena-jade/30' },
  REJECTED: { label: 'Not owed', className: 'bg-gray-100 text-gray-600 border-gray-300' },
};

export function AgentPayablesClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Payload>('/agent/payables')
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load your commission.'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-12 text-sorena-text/60">
        <Loader2 size={18} className="animate-spin" /> Loading…
      </div>
    );
  }

  const owed = Object.entries(data.totals.owedByCurrency).filter(([, v]) => v > 0);
  const paid = Object.entries(data.totals.paidByCurrency).filter(([, v]) => v > 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-sorena-navy">My commission</h1>
        <p className="mt-1 text-sm text-sorena-text/70">
          Your share of what Sorena earns on the clients you introduce.
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Total
          label="Owed to you"
          empty="Nothing owed yet."
          entries={owed}
          className="text-sorena-navy"
        />
        <Total
          label="Paid to you"
          empty="Nothing paid yet."
          entries={paid}
          className="text-sorena-jade"
        />
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-sorena-text/60">
          Commission appears here once one of your clients enrols and Sorena is paid by the provider.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((r) => {
            const s = STATUS[r.status] ?? STATUS.PENDING;
            return (
              <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sorena-navy">{r.studentName ?? 'Client'}</p>
                    <p className="mt-0.5 text-sm text-sorena-text/70">
                      {r.providerName ?? '—'}
                      {r.programmeName ? ` · ${r.programmeName}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-sorena-text/50">
                      {r.ratePercent}% share · raised {day(r.createdAt)}
                      {r.status === 'PAID' && ` · paid ${day(r.paidAt)}`}
                    </p>
                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-sorena-text/70">
                        Not owed: {r.rejectionReason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`text-lg font-bold tabular-nums ${r.status === 'REJECTED' ? 'text-sorena-text/40 line-through' : 'text-sorena-navy'}`}>
                      {money(r.currency, r.amountMinorUnits)}
                    </span>
                    <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${s.className}`}>
                      {s.label}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Total({
  label, entries, empty, className,
}: { label: string; entries: [string, number][]; empty: string; className: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-sorena-text/50">{label}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-sorena-text/60">{empty}</p>
      ) : (
        // Per currency, never added together — the rule this codebase applies
        // wherever money is totalled.
        <p className={`mt-1 text-2xl font-bold tabular-nums ${className}`}>
          {entries.map(([c, v]) => money(c, v)).join('  ·  ')}
        </p>
      )}
    </div>
  );
}
