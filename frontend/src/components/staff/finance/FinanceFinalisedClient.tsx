'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Landmark, Globe, Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';

// Finance portal — finalised (confirmed) payments ledger. Read-only list of
// engagement payments an accountant confirmed PAID. Data from
// GET /staff/finance/finalised (FINANCE/OWNER-gated server-side).

interface Row {
  invoiceId:     string;
  invoiceNumber: string;
  clientName:    string;
  caseId:        string | null;
  amountLabel:   string;
  method:        string | null; // 'bank' | 'exchange'
  confirmedAt:   string | null;
  confirmedBy:   string | null;
}

const METHOD_LABEL: Record<string, string> = { bank: 'Bank transfer', exchange: 'Partner exchange' };

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function FinanceFinalisedClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Row[]>('/staff/finance/finalised').then(setRows).catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-2 flex items-center gap-2">
        <CheckCircle2 size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Finalised payments</h1>
      </div>
      <p className="mb-6 text-sm text-sorena-text/70">
        Engagement payments you’ve confirmed as received. Read-only.
      </p>

      {error && <p className="text-sm text-red-600">Couldn’t load payments. Please refresh.</p>}
      {!rows && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-sorena-jade/40" />
          <p className="mt-3 text-sm text-sorena-text/60">No confirmed payments yet.</p>
        </div>
      )}

      <div className="space-y-2">
        {rows?.map((r) => {
          const MethodIcon = r.method === 'exchange' ? Globe : Landmark;
          return (
            <div key={r.invoiceId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sorena-navy">{r.clientName}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-sorena-jade/10 px-2 py-0.5 text-[11px] font-medium text-sorena-jade">
                      <CheckCircle2 size={11} /> Confirmed
                    </span>
                  </div>
                  <p className="mt-1 text-lg font-bold tracking-tight text-sorena-navy">{r.amountLabel}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-sorena-text/55">
                    <MethodIcon size={11} /> {r.method ? METHOD_LABEL[r.method] ?? r.method : '—'}
                    <span className="text-sorena-text/30">·</span>
                    <FileText size={11} /> {r.invoiceNumber}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-sorena-text/70">{fmtDate(r.confirmedAt)}</p>
                  <p className="text-[11px] text-sorena-text/45">by {r.confirmedBy ?? 'Finance'}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
